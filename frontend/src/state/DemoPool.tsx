import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Hash } from 'viem';
import { PoolContext, type PoolApi, type TxKind, type TxState } from './PoolContext';
import { useDemoMode } from './DemoMode';
import { outcomeFor, payoutFor, type VoteChoice } from '../lib/rules';
import { shortAddr, strategyHash, VOTE_LABEL } from '../lib/format';
import type { ActivityItem, Claim, Member } from '../lib/types';
import type { RoundTrip } from '../lib/roundTrip';

/**
 * A simulated pool for demos: same PoolApi as the real one, so every page works unchanged,
 * but the wallet, transactions and other members are pretend and nothing touches the chain.
 * Time runs fast: coverage starts after 20 seconds and voting lasts 60 seconds.
 */

export const DEMO_YOU = '0xde00000000000000000000000000000000000001';
export const DEMO_BAD_BUY = `0x${'bad1'.repeat(16)}`;
export const DEMO_BAD_SELL = `0x${'bad2'.repeat(16)}`;
const DEMO_USDC = '0x036cbd53842c5426634e7929541ec2318f3dcf7e';
const DEMO_PEPE = '0xde000000000000000000000000000000000beef0';
export const DEMO_AGENT = '0xde000000000000000000000000000000000000a1';
export const DEMO_STRATEGY = 'Only trades ETH/USDC on Uniswap. Max 25% of portfolio per trade. No leverage.';
const botAgent = (i: number) => `0x${'a9e0'.repeat(9)}000${i + 1}`;
const WAIT_MS = 20_000;
const VOTING_MS = 60_000;

const BOTS = [
  {
    address: '0xa11ce00000000000000000000000000000000a11',
    stake: 2,
    strategy: 'Only trades ETH/USDC on Uniswap. Max 10% of portfolio per trade. No leverage.',
  },
  {
    address: '0xb0b0000000000000000000000000000000000b0b',
    stake: 1.5,
    strategy: 'Market-makes cbBTC/USDC. Max 1% slippage. Never holds more than 50% in one token.',
  },
  {
    address: '0xca7000000000000000000000000000000000ca70',
    stake: 1,
    strategy: 'Buys ETH weekly with 5% of USDC balance. Never sells.',
  },
];

interface World {
  members: Member[];
  claims: Claim[];
  activity: ActivityItem[];
  poolAssets: number;
  usdcBalance: number;
  ethBalance: number;
}

function fakeHash(): Hash {
  return `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`;
}

let activitySeq = 0;
const act = (item: Omit<ActivityItem, 'id'>): ActivityItem => ({ id: `demo-${activitySeq++}`, ...item });

function seedWorld(now: number): World {
  const members: Member[] = BOTS.map((b, i) => ({
    address: b.address,
    label: shortAddr(b.address),
    agent: botAgent(i),
    strategyText: b.strategy,
    strategyHash: strategyHash(b.strategy),
    stake: b.stake,
    joinedAt: now - 3 * 3_600_000 + i * 60_000,
    coveredFrom: now - 3 * 3_600_000 + i * 60_000 + WAIT_MS,
    active: true,
  }));
  const past: Claim = {
    id: 1,
    claimant: BOTS[1].address,
    agent: members[1].agent,
    strategyHash: members[1].strategyHash,
    revealedStrategy: members[1].strategyText,
    txHash: fakeHash(),
    requested: 0.15,
    summary: 'The bot swapped 40% of the portfolio at 6% slippage during a liquidity crunch.',
    lossLines: [
      { direction: 'out', token: 'USDC', amount: 0.6, priceUsd: 1 },
      { direction: 'in', token: 'cbBTC', amount: 0.0000048, priceUsd: 93_750 },
    ],
    brokenRules: ['Max 1% slippage'],
    createdAt: now - 2 * 3_600_000,
    votingEnds: now - 2 * 3_600_000 + VOTING_MS,
    status: 'approved',
    approve: 3,
    reject: 0,
    fraud: 0,
    totalStakeSnapshot: 4.5,
    payout: 0.12,
    ballots: {},
  };
  const activity: ActivityItem[] = [
    act({ kind: 'resolved', at: past.votingEnds + 5_000, claimId: 1, status: 'approved', amount: 0.12 }),
    act({ kind: 'voted', at: past.createdAt + 30_000, actor: BOTS[2].address, claimId: 1, vote: 'approve', amount: 1 }),
    act({ kind: 'voted', at: past.createdAt + 20_000, actor: BOTS[0].address, claimId: 1, vote: 'approve', amount: 2 }),
    act({ kind: 'filed', at: past.createdAt, actor: BOTS[1].address, claimId: 1, amount: 0.15 }),
    ...members.map((m) => act({ kind: 'joined', at: m.joinedAt, actor: m.address, amount: m.stake })).reverse(),
  ];
  return { members, claims: [past], activity, poolAssets: 4.5 - 0.12, usdcBalance: 0, ethBalance: 0 };
}

interface DemoControls {
  badTrade: boolean;
  simulateBadTrade: () => void;
}
const DemoControlsContext = createContext<DemoControls | null>(null);

/** Demo-only controls for the guided tour; null outside demo mode. */
export function useDemoControls(): DemoControls | null {
  return useContext(DemoControlsContext);
}

export function DemoPoolProvider({ children }: { children: ReactNode }) {
  const { exit } = useDemoMode();
  const [world, setWorld] = useState<World>(() => seedWorld(Date.now()));
  const [now, setNow] = useState(() => Date.now());
  const [tx, setTx] = useState<TxState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<Hash | null>(null);
  const [badTrade, setBadTrade] = useState(false);
  const nextClaimId = useRef(2);
  const timers = useRef(new Set<number>());

  // Clock for countdowns.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  // Cancel every scheduled step (fake confirmations, bot votes) when demo mode closes.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((id) => clearTimeout(id));
      pending.clear();
    };
  }, []);

  const later = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timers.current.delete(id);
      fn();
    }, ms);
    timers.current.add(id);
  }, []);

  /** Plays a pretend transaction through the same stages as a real one, then applies its effect. */
  const fakeTx = useCallback(
    (kind: TxKind, label: string, doneLabel: string, apply: (hash: Hash) => void) =>
      new Promise<boolean>((resolve) => {
        setBusy(label);
        setTx({ kind, stage: 'wallet', label, doneLabel, hash: null });
        later(() => {
          const hash = fakeHash();
          setLastTx(hash);
          setTx({ kind, stage: 'pending', label, doneLabel, hash });
          later(() => {
            apply(hash);
            setTx({ kind, stage: 'confirmed', label, doneLabel, hash });
            setBusy(null);
            resolve(true);
          }, 1_400);
        }, 900);
      }),
    [later],
  );

  /** A demo member votes, if the claim is still open. */
  const botVote = useCallback((voter: string, claimId: number, choice: VoteChoice) => {
    setWorld((w) => {
      const voterStake = w.members.find((m) => m.address === voter)?.stake ?? 0;
      const claims = w.claims.map((c) =>
        c.id === claimId && c.status === 'open' && Date.now() < c.votingEnds
          ? { ...c, [choice]: c[choice] + voterStake }
          : c,
      );
      const activity = [
        act({ kind: 'voted', at: Date.now(), actor: voter, claimId, vote: choice, amount: voterStake }),
        ...w.activity,
      ];
      return { ...w, claims, activity };
    });
  }, []);

  const fileAs = useCallback(
    (
      claimant: Member,
      input: Pick<Claim, 'txHash' | 'sellTxHash' | 'summary' | 'lossLines' | 'requested' | 'brokenRules'>,
    ) => {
      const id = nextClaimId.current++;
      const at = Date.now();
      setWorld((w) => {
        const claim: Claim = {
          id,
          claimant: claimant.address,
          agent: claimant.agent,
          strategyHash: claimant.strategyHash,
          revealedStrategy: claimant.strategyText,
          ...input,
          createdAt: at,
          votingEnds: at + VOTING_MS,
          status: 'open',
          approve: 0,
          reject: 0,
          fraud: 0,
          totalStakeSnapshot: w.members.filter((m) => m.active).reduce((s, m) => s + m.stake, 0),
          payout: 0,
          ballots: {},
        };
        const activity = [
          act({ kind: 'filed', at, actor: claimant.address, claimId: id, amount: input.requested }),
          ...w.activity,
        ];
        return { ...w, claims: [claim, ...w.claims], activity };
      });
      return id;
    },
    [],
  );

  const me = world.members.find((m) => m.address === DEMO_YOU && m.active);

  const requestTestFunds = useCallback(async () => {
    const label = 'Requesting test USDC and ETH from the CDP faucet';
    setBusy(label);
    setTx({ kind: 'faucet', stage: 'pending', label, doneLabel: 'Test USDC and ETH received', hash: fakeHash() });
    await new Promise<void>((r) => later(r, 1_500));
    setWorld((w) => ({ ...w, usdcBalance: w.usdcBalance + 5, ethBalance: w.ethBalance + 0.01 }));
    setTx((t) => (t ? { ...t, stage: 'confirmed' } : t));
    setBusy(null);
  }, [later]);

  const join = useCallback<PoolApi['join']>(
    async (_agent, strategyText, amount) => {
      await fakeTx('approve', 'Approve the USDC transfer', 'USDC approved', () => {});
      return fakeTx('join', 'Joining the pool', 'You joined the pool', () => {
        const at = Date.now();
        const member: Member = {
          address: DEMO_YOU,
          label: 'You',
          agent: DEMO_AGENT,
          strategyText,
          strategyHash: strategyHash(strategyText),
          stake: amount,
          joinedAt: at,
          coveredFrom: at + WAIT_MS,
          active: true,
        };
        setWorld((w) => ({
          ...w,
          members: [...w.members.filter((m) => m.address !== DEMO_YOU), member],
          poolAssets: w.poolAssets + amount,
          usdcBalance: w.usdcBalance - amount,
          activity: [act({ kind: 'joined', at, actor: DEMO_YOU, amount }), ...w.activity],
        }));
        // Give the new member something to vote on.
        later(() => {
          const filer = seedBot(0);
          const id = fileAs(filer, {
            txHash: fakeHash(),
            summary: 'The bot opened a 3x leveraged ETH position on a perps exchange.',
            lossLines: [{ direction: 'out', token: 'USDC', amount: 0.5, priceUsd: 1 }],
            requested: 0.5,
            brokenRules: ['No leverage'],
          });
          later(() => botVote(BOTS[1].address, id, 'reject'), 12_000);
        }, 6_000);
      });
    },
    [botVote, fakeTx, fileAs, later],
  );

  const leave = useCallback(
    () =>
      fakeTx('leave', 'Leaving the pool', 'You left the pool', () =>
        setWorld((w) => {
          const stake = w.members.find((m) => m.address === DEMO_YOU)?.stake ?? 0;
          return {
            ...w,
            members: w.members.map((m) => (m.address === DEMO_YOU ? { ...m, active: false, stake: 0 } : m)),
            poolAssets: w.poolAssets - stake,
            usdcBalance: w.usdcBalance + stake,
            activity: [act({ kind: 'left', at: Date.now(), actor: DEMO_YOU, amount: stake }), ...w.activity],
          };
        }),
      ),
    [fakeTx],
  );

  const fileClaim = useCallback<PoolApi['fileClaim']>(
    async (input) => {
      if (!me) return null;
      let id: number | null = null;
      await fakeTx('claim', 'Filing your claim', 'Claim filed', () => {
        id = fileAs(me, {
          txHash: input.buyHash,
          sellTxHash: input.sellHash,
          summary: input.summary,
          lossLines: [],
          requested: input.requested,
          brokenRules: input.brokenRules,
        });
        const claimId = id;
        later(() => botVote(BOTS[0].address, claimId, 'approve'), 5_000);
        later(() => botVote(BOTS[2].address, claimId, 'approve'), 11_000);
        later(() => botVote(BOTS[1].address, claimId, 'reject'), 18_000);
      });
      return id;
    },
    [botVote, fakeTx, fileAs, later, me],
  );

  const vote = useCallback(
    (claimId: number, choice: VoteChoice) =>
      fakeTx('vote', 'Submitting your vote', `Vote confirmed: ${VOTE_LABEL[choice]} on claim #${claimId}`, () =>
        setWorld((w) => {
          const weight = w.members.find((m) => m.address === DEMO_YOU)?.stake ?? 0;
          return {
            ...w,
            claims: w.claims.map((c) =>
              c.id === claimId
                ? {
                    ...c,
                    [choice]: c[choice] + weight,
                    ballots: { ...c.ballots, [DEMO_YOU]: { vote: choice, weight } },
                  }
                : c,
            ),
            activity: [
              act({ kind: 'voted', at: Date.now(), actor: DEMO_YOU, claimId, vote: choice, amount: weight }),
              ...w.activity,
            ],
          };
        }),
      ),
    [fakeTx],
  );

  const resolve = useCallback(
    (claimId: number) =>
      fakeTx('resolve', 'Resolving the claim', `Claim #${claimId} resolved`, () =>
        setWorld((w) => {
          const c = w.claims.find((x) => x.id === claimId);
          if (!c || c.status !== 'open') return w;
          const status = outcomeFor(c);
          const claimant = w.members.find((m) => m.address === c.claimant);
          const payout = status === 'approved' ? payoutFor(c.requested, claimant?.stake ?? 0, w.poolAssets).payout : 0;
          return {
            ...w,
            claims: w.claims.map((x) => (x.id === claimId ? { ...x, status, payout } : x)),
            members:
              status === 'fraud'
                ? w.members.map((m) => (m.address === c.claimant ? { ...m, active: false, stake: 0 } : m))
                : w.members,
            poolAssets: w.poolAssets - payout,
            usdcBalance: w.usdcBalance + (c.claimant === DEMO_YOU ? payout : 0),
            activity: [act({ kind: 'resolved', at: Date.now(), claimId, status, amount: payout }), ...w.activity],
          };
        }),
      ),
    [fakeTx],
  );

  const readRoundTrip = useCallback<PoolApi['readRoundTrip']>(
    async (buyHash, sellHash, agent, coveredFrom) => {
      await new Promise<void>((r) => later(r, 700));
      if (buyHash.toLowerCase() !== DEMO_BAD_BUY || sellHash.toLowerCase() !== DEMO_BAD_SELL) {
        throw new Error('Demo mode only knows the simulated trades. Use "Bot slips up" in the demo bar.');
      }
      // Pretend the bad trade happened just after coverage started.
      const t = Math.max(coveredFrom, Date.now() - 60_000);
      const trade = (offset: number, out: string, outAmt: string, inn: string, innAmt: string) => ({
        from: agent as `0x${string}`,
        to: '0xde0000000000000000000000000000000000de15' as `0x${string}`,
        succeeded: true,
        timestamp: t + offset,
        blockNumber: 18_402_113n + BigInt(offset / 2_000),
        transactionIndex: 3,
        flows: [
          {
            direction: 'out' as const,
            token: out as `0x${string}`,
            symbol: out === DEMO_USDC ? 'USDC' : 'PEPE',
            amount: outAmt,
          },
          {
            direction: 'in' as const,
            token: inn as `0x${string}`,
            symbol: inn === DEMO_USDC ? 'USDC' : 'PEPE',
            amount: innAmt,
          },
        ],
      });
      const buy = trade(0, DEMO_USDC, '0.6', DEMO_PEPE, '41200');
      const sell = trade(20_000, DEMO_PEPE, '41200', DEMO_USDC, '0.38');
      const pair: RoundTrip = {
        buy,
        sell,
        spent: buy.flows[0],
        acquired: buy.flows[1],
        sold: sell.flows[0],
        received: sell.flows[1],
        buyValue: 0.6,
        sellValue: 0.38,
        loss: 0.22,
      };
      return pair;
    },
    [later],
  );

  const simulateBadTrade = useCallback(() => setBadTrade(true), []);
  const dismissTx = useCallback(() => setTx((t) => (t?.stage === 'confirmed' ? null : t)), []);
  const memberOf = useCallback((addr: string) => world.members.find((m) => m.address === addr), [world.members]);

  const api = useMemo<PoolApi>(
    () => ({
      ...world,
      openClaimCount: world.claims.filter((c) => c.status === 'open').length,
      params: { waitingPeriodMs: WAIT_MS, votingPeriodMs: VOTING_MS, minStake: 0.1 },
      you: DEMO_YOU,
      me,
      now,
      loading: false,
      error: null,
      busy,
      lastTx,
      tx,
      dismissTx,
      isConnected: true,
      wrongNetwork: false,
      memberOf,
      connect: async () => {},
      disconnect: exit,
      switchNetwork: async () => {},
      dismissError: () => {},
      requestTestFunds,
      join,
      leave,
      fileClaim,
      vote,
      resolve,
      readRoundTrip,
    }),
    [
      world,
      me,
      now,
      busy,
      lastTx,
      tx,
      dismissTx,
      memberOf,
      exit,
      requestTestFunds,
      join,
      leave,
      fileClaim,
      vote,
      resolve,
      readRoundTrip,
    ],
  );
  const controls = useMemo(() => ({ badTrade, simulateBadTrade }), [badTrade, simulateBadTrade]);

  return (
    <DemoControlsContext.Provider value={controls}>
      <PoolContext.Provider value={api}>{children}</PoolContext.Provider>
    </DemoControlsContext.Provider>
  );
}

/** Seed bot as a Member, for filing claims on its behalf. */
function seedBot(i: number): Member {
  const b = BOTS[i];
  return {
    address: b.address,
    label: shortAddr(b.address),
    agent: botAgent(i),
    strategyText: b.strategy,
    strategyHash: strategyHash(b.strategy),
    stake: b.stake,
    joinedAt: 0,
    coveredFrom: 0,
    active: true,
  };
}
