import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAccount, useConfig, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { getPublicClient, waitForTransactionReceipt, writeContract } from 'wagmi/actions';
import { decodeEventLog, formatUnits, getAddress, parseUnits, type Address, type Hash, type PublicClient, type TransactionReceipt } from 'viem';
import { agentInsurancePoolAbi, erc20Abi } from '../lib/abi';
import { CHAIN, POOL_ADDRESS, USDC_ADDRESS, USDC_DECIMALS } from '../lib/chain';
import { shortAddr, strategyHash } from '../lib/format';
import type { ClaimStatus, LossLine, VoteChoice } from '../lib/rules';
import type { Claim, Member } from '../lib/types';

// Reads pool state from the deployed AgentInsurancePool on Base Sepolia and sends
// transactions through the connected browser wallet.

const STATUS_FROM_INDEX: ClaimStatus[] = ['open', 'open', 'approved', 'rejected', 'fraud', 'noQuorum'];
const VOTE_TO_INDEX: Record<VoteChoice, number> = { approve: 1, reject: 2, fraud: 3 };
const VOTE_FROM_INDEX: (VoteChoice | null)[] = [null, 'approve', 'reject', 'fraud'];

export interface PoolParams {
  waitingPeriodMs: number;
  votingPeriodMs: number;
  minStake: number;
}

interface Snapshot {
  members: Member[];
  claims: Claim[];
  poolAssets: number;
  openClaimCount: number;
  params: PoolParams;
  usdcBalance: number;
  ethBalance: number;
}

interface JoinInfo {
  agent: Address;
  strategyURI: string;
}

interface PoolApi extends Snapshot {
  you: string;
  me: Member | undefined;
  now: number;
  loading: boolean;
  error: string | null;
  busy: string | null;
  lastTx: Hash | null;
  isConnected: boolean;
  wrongNetwork: boolean;
  memberOf: (address: string) => Member | undefined;
  connect: () => Promise<void>;
  disconnect: () => void;
  switchNetwork: () => Promise<void>;
  dismissError: () => void;
  requestTestFunds: () => Promise<void>;
  join: (agent: string, strategyText: string, amount: number) => Promise<boolean>;
  leave: () => Promise<boolean>;
  fileClaim: (input: { txHash: string; summary: string; lossLines: LossLine[]; requested: number }) => Promise<number | null>;
  vote: (claimId: number, choice: VoteChoice) => Promise<boolean>;
  resolve: (claimId: number) => Promise<boolean>;
}

const PoolContext = createContext<PoolApi | null>(null);

const EMPTY: Snapshot = {
  members: [],
  claims: [],
  poolAssets: 0,
  openClaimCount: 0,
  params: { waitingPeriodMs: 0, votingPeriodMs: 0, minStake: 0 },
  usdcBalance: 0,
  ethBalance: 0,
};

const toUsd = (units: bigint) => Number(formatUnits(units, USDC_DECIMALS));
const pool = { address: POOL_ADDRESS, abi: agentInsurancePoolAbi } as const;

function errorMessage(e: unknown): string {
  const raw = (e as { shortMessage?: string }).shortMessage ?? (e instanceof Error ? e.message : String(e));
  if (/user rejected|user denied/i.test(raw)) return 'You cancelled the request in your wallet.';
  if (/provider not found|no provider/i.test(raw)) return 'No browser wallet found. Install Coinbase Wallet or MetaMask.';
  return raw.length > 240 ? `${raw.slice(0, 240)}…` : raw;
}

/** Evidence is written by claimants, so validate each line instead of trusting its shape. */
function toLossLine(raw: unknown): LossLine[] {
  const l = raw as { direction?: unknown; token?: unknown; amount?: unknown; priceUsd?: unknown; price?: unknown };
  const amount = Number(l.amount);
  const priceUsd = Number(l.priceUsd ?? l.price);
  if ((l.direction !== 'out' && l.direction !== 'in') || !Number.isFinite(amount) || !Number.isFinite(priceUsd)) return [];
  return [{ direction: l.direction, token: String(l.token ?? '?'), amount, priceUsd }];
}

/** Evidence is stored on-chain as JSON: { summary, lossLines }. Anything else is shown as plain text. */
function parseEvidence(evidenceURI: string): { summary: string; lossLines: LossLine[] } {
  try {
    const parsed = JSON.parse(evidenceURI) as { summary?: unknown; lossLines?: unknown };
    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      lossLines: Array.isArray(parsed.lossLines) ? parsed.lossLines.flatMap(toLossLine) : [],
    };
  } catch {
    return { summary: evidenceURI, lossLines: [] };
  }
}

/**
 * Every address that ever joined, with its latest Joined event. Served by the dev server
 * from the CDP SQL API (see vite.config.ts); the public RPC caps log queries at 200 blocks.
 */
async function fetchJoins(): Promise<Map<Address, JoinInfo>> {
  const res = await fetch('/api/members');
  const body = (await res.json()) as { joins?: { member: string; agent: string; strategyURI: string }[]; error?: string };
  if (!res.ok || !body.joins) throw new Error(body.error ?? 'Could not load the member list');
  const joins = new Map<Address, JoinInfo>();
  for (const j of body.joins) joins.set(getAddress(j.member), { agent: getAddress(j.agent), strategyURI: j.strategyURI });
  return joins;
}

async function fetchSnapshot(client: PublicClient, you: Address | undefined): Promise<Snapshot> {
  const joins = await fetchJoins();

  const [totalShares, totalAssets, claimCount, openClaimCount, minStake, waitingPeriod, votingPeriod] =
    await client.multicall({
      allowFailure: false,
      contracts: [
        { ...pool, functionName: 'totalShares' },
        { ...pool, functionName: 'totalAssets' },
        { ...pool, functionName: 'claimCount' },
        { ...pool, functionName: 'openClaimCount' },
        { ...pool, functionName: 'minStake' },
        { ...pool, functionName: 'WAITING_PERIOD' },
        { ...pool, functionName: 'VOTING_PERIOD' },
      ],
    });
  const sharesToUsd = (shares: bigint) => (totalShares === 0n ? 0 : toUsd((shares * totalAssets) / totalShares));

  const addresses = [...joins.keys()];
  const memberReads = addresses.length
    ? await client.multicall({
        allowFailure: false,
        contracts: addresses.flatMap((a) => [
          { ...pool, functionName: 'getMember', args: [a] } as const,
          { ...pool, functionName: 'stakeValue', args: [a] } as const,
        ]),
      })
    : [];

  const members: Member[] = addresses.map((address, i) => {
    const onchain = memberReads[i * 2] as {
      agent: Address;
      strategyHash: string;
      strategyURI: string;
      joinedAt: bigint;
      coveredFrom: bigint;
      active: boolean;
    };
    const value = memberReads[i * 2 + 1] as bigint;
    const info = joins.get(address)!;
    return {
      address,
      label: you && address === you ? 'You' : shortAddr(address),
      agent: onchain.active ? onchain.agent : info.agent,
      // Former members are deleted on-chain, so fall back to their Joined event.
      strategyText: onchain.active ? onchain.strategyURI : info.strategyURI,
      strategyHash: onchain.active ? onchain.strategyHash : strategyHash(info.strategyURI),
      stake: onchain.active ? toUsd(value) : 0,
      joinedAt: Number(onchain.joinedAt) * 1000,
      coveredFrom: Number(onchain.coveredFrom) * 1000,
      active: onchain.active,
    };
  });

  const ids = Array.from({ length: Number(claimCount) }, (_, i) => BigInt(i + 1));
  const claimReads = ids.length
    ? await client.multicall({
        allowFailure: false,
        contracts: ids.flatMap((id) => [
          { ...pool, functionName: 'getClaim', args: [id] } as const,
          ...(you
            ? ([
                { ...pool, functionName: 'votes', args: [id, you] },
                { ...pool, functionName: 'voteWeight', args: [id, you] },
              ] as const)
            : []),
        ]),
      })
    : [];
  const stride = you ? 3 : 1;

  const claims: Claim[] = ids
    .map((id, i) => {
      const c = claimReads[i * stride] as {
        claimant: Address;
        agent: Address;
        txHash: Hash;
        requestedAmount: bigint;
        evidenceURI: string;
        createdAt: bigint;
        votingEnds: bigint;
        status: number;
        totalSharesSnapshot: bigint;
        approveWeight: bigint;
        rejectWeight: bigint;
        fraudWeight: bigint;
        payout: bigint;
      };
      const myVote = you ? VOTE_FROM_INDEX[Number(claimReads[i * stride + 1])] : null;
      const myWeight = you ? (claimReads[i * stride + 2] as bigint) : 0n;
      const claimant = members.find((m) => m.address === c.claimant);
      const evidence = parseEvidence(c.evidenceURI);
      return {
        id: Number(id),
        claimant: c.claimant,
        agent: c.agent,
        strategyHash: claimant?.strategyHash ?? '',
        revealedStrategy: claimant?.strategyText ?? '',
        txHash: c.txHash,
        requested: toUsd(c.requestedAmount),
        summary: evidence.summary,
        lossLines: evidence.lossLines,
        createdAt: Number(c.createdAt) * 1000,
        votingEnds: Number(c.votingEnds) * 1000,
        status: STATUS_FROM_INDEX[c.status] ?? 'open',
        approve: sharesToUsd(c.approveWeight),
        reject: sharesToUsd(c.rejectWeight),
        fraud: sharesToUsd(c.fraudWeight),
        totalStakeSnapshot: sharesToUsd(c.totalSharesSnapshot),
        payout: toUsd(c.payout),
        ballots: you && myVote ? { [you]: { vote: myVote, weight: sharesToUsd(myWeight) } } : {},
      };
    })
    .reverse();

  let usdcBalance = 0;
  let ethBalance = 0;
  if (you) {
    const [usdc, eth] = await Promise.all([
      client.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'balanceOf', args: [you] }),
      client.getBalance({ address: you }),
    ]);
    usdcBalance = toUsd(usdc);
    ethBalance = Number(formatUnits(eth, 18));
  }

  return {
    members,
    claims,
    poolAssets: toUsd(totalAssets),
    openClaimCount: Number(openClaimCount),
    params: {
      waitingPeriodMs: Number(waitingPeriod) * 1000,
      votingPeriodMs: Number(votingPeriod) * 1000,
      minStake: toUsd(minStake),
    },
    usdcBalance,
    ethBalance,
  };
}

export function PoolProvider({ children }: { children: ReactNode }) {
  const config = useConfig();
  const { address, chainId, isConnected } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();

  const [snap, setSnap] = useState<Snapshot>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<Hash | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const you = address ?? '';
  const wrongNetwork = isConnected && chainId !== CHAIN.id;
  const client = useMemo(() => getPublicClient(config, { chainId: CHAIN.id }) as PublicClient, [config]);

  const refresh = useCallback(async () => {
    try {
      setSnap(await fetchSnapshot(client, address));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [client, address]);

  // Poll the chain so votes and claims from other members show up.
  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const id = setInterval(() => void refresh(), 15_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [refresh]);

  // Clock for countdowns.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  const runTx = useCallback(
    async (label: string, send: () => Promise<Hash>): Promise<TransactionReceipt | null> => {
      setError(null);
      try {
        if (wrongNetwork) await switchChainAsync({ chainId: CHAIN.id });
        setBusy(label);
        const hash = await send();
        setLastTx(hash);
        const receipt = await waitForTransactionReceipt(config, { hash, chainId: CHAIN.id });
        if (receipt.status !== 'success') throw new Error('The transaction failed on-chain.');
        await refresh();
        return receipt;
      } catch (e) {
        setError(errorMessage(e));
        return null;
      } finally {
        setBusy(null);
      }
    },
    [config, refresh, switchChainAsync, wrongNetwork],
  );

  const connect = useCallback(async () => {
    setError(null);
    const connector = connectors[0];
    if (!connector) {
      setError('No browser wallet found. Install Coinbase Wallet or MetaMask.');
      return;
    }
    try {
      await connectAsync({ connector, chainId: CHAIN.id });
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [connectAsync, connectors]);

  const switchNetwork = useCallback(async () => {
    try {
      await switchChainAsync({ chainId: CHAIN.id });
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [switchChainAsync]);

  const requestTestFunds = useCallback(async () => {
    if (!address) return;
    setError(null);
    setBusy('Requesting test USDC and ETH from the CDP faucet…');
    try {
      const res = await fetch('/api/faucet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      const body = (await res.json()) as { usdcTx?: Hash; error?: string };
      if (!res.ok || !body.usdcTx) throw new Error(body.error ?? 'Faucet request failed');
      setLastTx(body.usdcTx);
      await client.waitForTransactionReceipt({ hash: body.usdcTx });
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }, [address, client, refresh]);

  const join = useCallback<PoolApi['join']>(
    async (agent, strategyText, amount) => {
      if (!address) return false;
      const units = parseUnits(amount.toFixed(USDC_DECIMALS), USDC_DECIMALS);
      const allowance = await client.readContract({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [address, POOL_ADDRESS],
      });
      if (allowance < units) {
        const approved = await runTx('Approve the USDC transfer in your wallet…', () =>
          writeContract(config, { chainId: CHAIN.id, address: USDC_ADDRESS, abi: erc20Abi, functionName: 'approve', args: [POOL_ADDRESS, units] }),
        );
        if (!approved) return false;
      }
      const joined = await runTx('Joining the pool…', () =>
        writeContract(config, {
          ...pool,
          chainId: CHAIN.id,
          functionName: 'join',
          args: [agent as Address, strategyHash(strategyText), strategyText, units],
        }),
      );
      return joined !== null;
    },
    [address, client, config, runTx],
  );

  const leave = useCallback(async () => {
    const r = await runTx('Leaving the pool…', () => writeContract(config, { ...pool, chainId: CHAIN.id, functionName: 'leave' }));
    return r !== null;
  }, [config, runTx]);

  const fileClaim = useCallback<PoolApi['fileClaim']>(
    async ({ txHash, summary, lossLines, requested }) => {
      const evidence = JSON.stringify({ summary, lossLines });
      const units = parseUnits(requested.toFixed(USDC_DECIMALS), USDC_DECIMALS);
      const receipt = await runTx('Filing your claim…', () =>
        writeContract(config, { ...pool, chainId: CHAIN.id, functionName: 'fileClaim', args: [txHash as Hash, units, evidence] }),
      );
      if (!receipt) return null;
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== POOL_ADDRESS.toLowerCase()) continue;
        try {
          const decoded = decodeEventLog({ abi: agentInsurancePoolAbi, data: log.data, topics: log.topics });
          if (decoded.eventName === 'ClaimFiled') return Number(decoded.args.claimId);
        } catch {
          // not one of our events
        }
      }
      return null;
    },
    [config, runTx],
  );

  const vote = useCallback(
    async (claimId: number, choice: VoteChoice) => {
      const r = await runTx('Submitting your vote…', () =>
        writeContract(config, { ...pool, chainId: CHAIN.id, functionName: 'vote', args: [BigInt(claimId), VOTE_TO_INDEX[choice]] }),
      );
      return r !== null;
    },
    [config, runTx],
  );

  const resolve = useCallback(
    async (claimId: number) => {
      const r = await runTx('Resolving the claim…', () =>
        writeContract(config, { ...pool, chainId: CHAIN.id, functionName: 'resolve', args: [BigInt(claimId)] }),
      );
      return r !== null;
    },
    [config, runTx],
  );

  const memberOf = useCallback((addr: string) => snap.members.find((m) => m.address === addr), [snap.members]);
  const me = snap.members.find((m) => m.address === you && m.active);

  const api = useMemo<PoolApi>(
    () => ({
      ...snap,
      you,
      me,
      now,
      loading,
      error,
      busy,
      lastTx,
      isConnected,
      wrongNetwork,
      memberOf,
      connect,
      disconnect: () => disconnect(),
      switchNetwork,
      dismissError: () => setError(null),
      requestTestFunds,
      join,
      leave,
      fileClaim,
      vote,
      resolve,
    }),
    [snap, you, me, now, loading, error, busy, lastTx, isConnected, wrongNetwork, memberOf, connect, disconnect, switchNetwork, requestTestFunds, join, leave, fileClaim, vote, resolve],
  );

  return <PoolContext.Provider value={api}>{children}</PoolContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePool(): PoolApi {
  const ctx = useContext(PoolContext);
  if (!ctx) throw new Error('usePool must be used inside PoolProvider');
  return ctx;
}
