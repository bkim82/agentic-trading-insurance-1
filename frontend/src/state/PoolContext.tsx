import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { initialClaims, initialMembers, YOU } from '../lib/mockData';
import { outcomeFor, payoutFor, RULES, type LossLine, type VoteChoice } from '../lib/rules';
import { strategyHash } from '../lib/format';
import type { Claim, Member } from '../lib/types';

// In-memory stand-in for the contract. Each action maps to one contract call
// (join, leave, fileClaim, vote, resolve); swap the bodies for viem/wagmi writes when wiring up.

interface PoolState {
  members: Member[];
  claims: Claim[];
  baseNow: number; // clock captured at load; demo time = baseNow + timeOffsetMs
  timeOffsetMs: number; // demo-only "skip ahead" control
}

interface PoolApi extends PoolState {
  you: string;
  me: Member | undefined;
  now: number;
  poolAssets: number;
  openClaimCount: number;
  memberOf: (address: string) => Member | undefined;
  join: (agent: string, strategyText: string, amount: number) => void;
  leave: () => void;
  fileClaim: (input: { txHash: string; summary: string; lossLines: LossLine[]; requested: number }) => number;
  vote: (claimId: number, choice: VoteChoice) => void;
  resolve: (claimId: number) => void;
  skipAhead: (ms: number) => void;
}

const PoolContext = createContext<PoolApi | null>(null);

const INITIAL: PoolState = {
  members: initialMembers,
  claims: initialClaims,
  baseNow: Date.now(),
  timeOffsetMs: 0,
};

const activeTotal = (members: Member[]) => members.filter((m) => m.active).reduce((s, m) => s + m.stake, 0);

/** Spread a gain (positive) or loss (negative) across active members in proportion to stake. */
function redistribute(members: Member[], delta: number): Member[] {
  const base = activeTotal(members);
  if (base === 0) return members;
  const factor = (base + delta) / base;
  return members.map((m) => (m.active ? { ...m, stake: m.stake * factor } : m));
}

/** Losing voters (pay vs. don't pay) lose 1% of stake, split among winners by vote weight. */
function settleVoters(members: Member[], claim: Claim, pay: boolean): Member[] {
  const isActive = (addr: string) => members.some((m) => m.address === addr && m.active);
  const entries = Object.entries(claim.ballots).filter(([addr]) => isActive(addr));
  const winners = entries.filter(([, b]) => (b.vote === 'approve') === pay);
  const losers = new Set(entries.filter(([, b]) => (b.vote === 'approve') !== pay).map(([a]) => a));
  const winWeight = winners.reduce((s, [, b]) => s + b.weight, 0);

  let collected = 0;
  let next = members.map((m) => {
    if (!losers.has(m.address)) return m;
    const penalty = m.stake * RULES.voterPenaltyPct;
    collected += penalty;
    return { ...m, stake: m.stake - penalty };
  });
  if (collected === 0) return next;
  if (winWeight === 0) return redistribute(next, collected);

  const rewards = new Map(winners.map(([addr, b]) => [addr, (collected * b.weight) / winWeight]));
  next = next.map((m) => (rewards.has(m.address) ? { ...m, stake: m.stake + rewards.get(m.address)! } : m));
  return next;
}

export function PoolProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PoolState>(INITIAL);
  const now = state.baseNow + state.timeOffsetMs;
  const poolAssets = activeTotal(state.members);
  const me = state.members.find((m) => m.address === YOU && m.active);
  const openClaimCount = state.claims.filter((c) => c.status === 'open').length;

  const memberOf = useCallback(
    (address: string) => state.members.find((m) => m.address === address),
    [state.members],
  );

  const join = useCallback((agent: string, strategyText: string, amount: number) => {
    setState((s) => {
      const t = s.baseNow + s.timeOffsetMs;
      const mine: Member = {
        address: YOU,
        label: 'You',
        agent,
        strategyText,
        strategyHash: strategyHash(strategyText),
        stake: amount,
        joinedAt: t,
        coveredFrom: t + RULES.waitingPeriodMs,
        active: true,
      };
      return { ...s, members: [mine, ...s.members.filter((m) => m.address !== YOU)] };
    });
  }, []);

  const leave = useCallback(() => {
    setState((s) => ({
      ...s,
      members: s.members.map((m) => (m.address === YOU ? { ...m, active: false, stake: 0 } : m)),
    }));
  }, []);

  const fileClaim = useCallback<PoolApi['fileClaim']>(
    (input) => {
      const id = Math.max(0, ...state.claims.map((c) => c.id)) + 1;
      setState((s) => {
        const m = s.members.find((x) => x.address === YOU)!;
        const t = s.baseNow + s.timeOffsetMs;
        const c: Claim = {
          id,
          claimant: YOU,
          agent: m.agent,
          strategyHash: m.strategyHash,
          revealedStrategy: m.strategyText,
          txHash: input.txHash,
          requested: input.requested,
          summary: input.summary,
          lossLines: input.lossLines,
          createdAt: t,
          votingEnds: t + RULES.votingPeriodMs,
          status: 'open',
          approve: 0,
          reject: 0,
          fraud: 0,
          totalStakeSnapshot: activeTotal(s.members),
          payout: 0,
          ballots: {},
        };
        return { ...s, claims: [c, ...s.claims] };
      });
      return id;
    },
    [state.claims],
  );

  const vote = useCallback((claimId: number, choice: VoteChoice) => {
    setState((s) => {
      const weight = s.members.find((x) => x.address === YOU)!.stake;
      return {
        ...s,
        claims: s.claims.map((c) =>
          c.id !== claimId
            ? c
            : { ...c, [choice]: c[choice] + weight, ballots: { ...c.ballots, [YOU]: { vote: choice, weight } } },
        ),
      };
    });
  }, []);

  const resolve = useCallback((claimId: number) => {
    setState((s) => {
      const c = s.claims.find((x) => x.id === claimId)!;
      const status = outcomeFor(c);
      let members = s.members;
      let payout = 0;

      if (status !== 'noQuorum') members = settleVoters(members, c, status === 'approved');

      if (status === 'approved') {
        const claimant = members.find((m) => m.address === c.claimant)!;
        payout = payoutFor(c.requested, claimant.stake, activeTotal(members)).payout;
        members = redistribute(members, -payout);
      } else if (status === 'fraud') {
        const slashed = members.find((m) => m.address === c.claimant)!.stake;
        members = members.map((m) => (m.address === c.claimant ? { ...m, stake: 0, active: false } : m));
        members = redistribute(members, slashed);
      }

      return { ...s, members, claims: s.claims.map((x) => (x.id === claimId ? { ...x, status, payout } : x)) };
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
      openClaimCount,
      memberOf,
      join,
      leave,
      fileClaim,
      vote,
      resolve,
      skipAhead,
    }),
    [state, me, now, poolAssets, openClaimCount, memberOf, join, leave, fileClaim, vote, resolve, skipAhead],
  );

  return <PoolContext.Provider value={api}>{children}</PoolContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePool(): PoolApi {
  const ctx = useContext(PoolContext);
  if (!ctx) throw new Error('usePool must be used inside PoolProvider');
  return ctx;
}
