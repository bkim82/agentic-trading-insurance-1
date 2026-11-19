import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { initialClaims, initialMembers, YOU } from '../lib/mockData';
import { outcomeFor, payoutFor, RULES, type LossLine, type VoteChoice } from '../lib/rules';
import { strategyHash } from '../lib/format';
import type { Claim, Member } from '../lib/types';

// In-memory stand-in for the contract. Every action here maps to one contract call;
// swap the bodies for viem/wagmi writes when wiring up.

interface PoolState {
  members: Member[];
  claims: Claim[];
  escrow: number; // voter bonds held in escrow
  baseNow: number; // clock captured at load; demo time = baseNow + timeOffsetMs
  timeOffsetMs: number; // demo-only "skip ahead" control
}

interface PoolApi extends PoolState {
  you: string;
  me: Member | undefined;
  now: number;
  poolAssets: number;
  totalStake: number;
  openClaimCount: number;
  memberOf: (address: string) => Member | undefined;
  join: (agent: string, strategyText: string, amount: number) => void;
  updateStrategy: (strategyText: string) => void;
  leave: () => void;
  fileClaim: (input: { txHashes: string[]; summary: string; lossLines: LossLine[]; requested: number }) => number;
  refileClaim: (claimId: number, requested: number, summary: string) => number;
  vote: (claimId: number, choice: VoteChoice) => void;
  resolve: (claimId: number) => void;
  settleVote: (claimId: number) => void;
  skipAhead: (ms: number) => void;
}

const PoolContext = createContext<PoolApi | null>(null);

const INITIAL: PoolState = {
  members: initialMembers,
  claims: initialClaims,
  escrow: 300 + 600 + 250, // unsettled bonds in the mock claims
  baseNow: Date.now(),
  timeOffsetMs: 0,
};

/** Spread a gain (positive) or loss (negative) across active members in proportion to stake. */
function redistribute(members: Member[], delta: number, exclude?: string): Member[] {
  const base = members.filter((m) => m.active && m.address !== exclude).reduce((s, m) => s + m.stake, 0);
  if (base === 0) return members;
  const factor = (base + delta) / base;
  return members.map((m) => (m.active && m.address !== exclude ? { ...m, stake: m.stake * factor } : m));
}

export function PoolProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PoolState>(INITIAL);
  const now = state.baseNow + state.timeOffsetMs;

  const totalStake = state.members.filter((m) => m.active).reduce((s, m) => s + m.stake, 0);
  const poolAssets = totalStake + state.escrow;
  const me = state.members.find((m) => m.address === YOU && m.active);
  const openClaimCount = state.claims.filter((c) => c.status === 'open').length;

  const memberOf = useCallback(
    (address: string) => state.members.find((m) => m.address === address),
    [state.members],
  );

  const join = useCallback((agent: string, strategyText: string, amount: number) => {
    setState((s) => {
      const t = s.baseNow + s.timeOffsetMs;
      const others = s.members.filter((m) => m.address !== YOU);
      const mine: Member = {
        address: YOU,
        label: 'You',
        agent,
        strategyText,
        strategyHash: strategyHash(strategyText),
        strategyVersion: 1,
        stake: amount,
        joinedAt: t,
        coveredFrom: t + RULES.waitingPeriodMs,
        active: true,
        banned: false,
      };
      return { ...s, members: [mine, ...others] };
    });
  }, []);

  const updateStrategy = useCallback((strategyText: string) => {
    setState((s) => {
      const t = s.baseNow + s.timeOffsetMs;
      return {
        ...s,
        members: s.members.map((m) =>
          m.address === YOU
            ? {
                ...m,
                strategyText,
                strategyHash: strategyHash(strategyText),
                strategyVersion: m.strategyVersion + 1,
                coveredFrom: t + RULES.waitingPeriodMs,
              }
            : m,
        ),
      };
    });
  }, []);

  const leave = useCallback(() => {
    setState((s) => ({
      ...s,
      members: s.members.map((m) => (m.address === YOU ? { ...m, active: false, stake: 0 } : m)),
    }));
  }, []);

  const fileClaim = useCallback<PoolApi['fileClaim']>((input) => {
    const id = Math.max(0, ...state.claims.map((c) => c.id)) + 1;
    setState((s) => {
      const m = s.members.find((x) => x.address === YOU)!;
      const t = s.baseNow + s.timeOffsetMs;
      const total = s.members.filter((x) => x.active).reduce((sum, x) => sum + x.stake, 0);
      const c: Claim = {
        id,
        claimant: YOU,
        agent: m.agent,
        strategyHash: m.strategyHash,
        strategyVersion: m.strategyVersion,
        revealedStrategy: m.strategyText,
        txHashes: input.txHashes,
        requested: input.requested,
        bond: input.requested * RULES.claimBondPct,
        summary: input.summary,
        lossLines: input.lossLines,
        createdAt: t,
        votingEnds: t + RULES.votingPeriodMs,
        status: 'open',
        approve: 0,
        reject: 0,
        fraud: 0,
        payBonds: 0,
        noPayBonds: 0,
        totalStakeSnapshot: total,
        payout: 0,
        refileOf: null,
        refiled: false,
        ballots: {},
      };
      return { ...s, claims: [c, ...s.claims] };
    });
    return id;
  }, [state.claims]);

  const refileClaim = useCallback<PoolApi['refileClaim']>((claimId, requested, summary) => {
    const prev = state.claims.find((c) => c.id === claimId)!;
    const newId = fileClaim({ txHashes: prev.txHashes, summary, lossLines: prev.lossLines, requested });
    setState((s) => ({
      ...s,
      claims: s.claims.map((c) => {
        if (c.id === claimId) return { ...c, refiled: true };
        if (c.id === newId) return { ...c, refileOf: claimId };
        return c;
      }),
    }));
    return newId;
  }, [state.claims, fileClaim]);

  const vote = useCallback((claimId: number, choice: VoteChoice) => {
    setState((s) => {
      const m = s.members.find((x) => x.address === YOU)!;
      const weight = m.stake;
      const bond = weight * RULES.voterBondPct;
      return {
        ...s,
        escrow: s.escrow + bond,
        members: s.members.map((x) => (x.address === YOU ? { ...x, stake: x.stake - bond } : x)),
        claims: s.claims.map((c) => {
          if (c.id !== claimId) return c;
          return {
            ...c,
            [choice]: c[choice] + weight,
            payBonds: choice === 'approve' ? c.payBonds + bond : c.payBonds,
            noPayBonds: choice === 'approve' ? c.noPayBonds : c.noPayBonds + bond,
            ballots: { ...c.ballots, [YOU]: { vote: choice, weight, bond, settled: false } },
          };
        }),
      };
    });
  }, []);

  const resolve = useCallback((claimId: number) => {
    setState((s) => {
      const c = s.claims.find((x) => x.id === claimId)!;
      const status = outcomeFor(c);
      let members = s.members;
      let payout = 0;
      const claimant = members.find((m) => m.address === c.claimant)!;
      const assets = members.filter((m) => m.active).reduce((sum, m) => sum + m.stake, 0) + s.escrow;

      if (status === 'approved') {
        payout = payoutFor(c.requested, claimant.stake, assets).payout;
        members = redistribute(members, -payout);
      } else if (status === 'fraud') {
        const slashed = claimant.stake;
        members = members.map((m) => (m.address === c.claimant ? { ...m, stake: 0, active: false, banned: true } : m));
        members = redistribute(members, slashed + c.bond);
      } else if (status === 'rejected') {
        members = redistribute(members, c.bond, c.claimant);
      }

      return {
        ...s,
        members,
        claims: s.claims.map((x) => (x.id === claimId ? { ...x, status, payout } : x)),
      };
    });
  }, []);

  const settleVote = useCallback((claimId: number) => {
    setState((s) => {
      const c = s.claims.find((x) => x.id === claimId)!;
      const b = c.ballots[YOU];
      if (!b || b.settled) return s;
      let reward = 0;
      if (c.status === 'noQuorum') {
        reward = b.bond;
      } else {
        const paid = c.status === 'approved';
        const votedPay = b.vote === 'approve';
        if (paid === votedPay) {
          const win = paid ? c.payBonds : c.noPayBonds;
          const lose = paid ? c.noPayBonds : c.payBonds;
          reward = b.bond + (win > 0 ? (b.bond * lose) / win : 0);
        }
      }
      return {
        ...s,
        escrow: Math.max(0, s.escrow - reward),
        members: s.members.map((m) => (m.address === YOU ? { ...m, stake: m.stake + reward } : m)),
        claims: s.claims.map((x) =>
          x.id === claimId ? { ...x, ballots: { ...x.ballots, [YOU]: { ...b, settled: true } } } : x,
        ),
      };
    });
  }, []);

  const skipAhead = useCallback((ms: number) => {
    setState((s) => ({ ...s, timeOffsetMs: s.timeOffsetMs + ms }));
  }, []);

  const api = useMemo<PoolApi>(
    () => ({
      ...state,
      you: YOU,
      me,
      now,
      poolAssets,
      totalStake,
      openClaimCount,
      memberOf,
      join,
      updateStrategy,
      leave,
      fileClaim,
      refileClaim,
      vote,
      resolve,
      settleVote,
      skipAhead,
    }),
    [state, me, now, poolAssets, totalStake, openClaimCount, memberOf, join, updateStrategy, leave, fileClaim, refileClaim, vote, resolve, settleVote, skipAhead],
  );

  return <PoolContext.Provider value={api}>{children}</PoolContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePool(): PoolApi {
  const ctx = useContext(PoolContext);
  if (!ctx) throw new Error('usePool must be used inside PoolProvider');
  return ctx;
}
