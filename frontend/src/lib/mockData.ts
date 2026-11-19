import { DAY, RULES } from './rules';
import { strategyHash } from './format';
import type { Claim, Member } from './types';

export const YOU = '0x1111aaaa2222bbbb3333cccc4444dddd5555eeee';

const now = Date.now();

function member(
  address: string,
  label: string,
  agent: string,
  stake: number,
  strategyText: string,
  joinedDaysAgo: number,
): Member {
  const joinedAt = now - joinedDaysAgo * DAY;
  return {
    address,
    label,
    agent,
    strategyText,
    strategyHash: strategyHash(strategyText),
    stake,
    joinedAt,
    coveredFrom: joinedAt + RULES.waitingPeriodMs,
    active: true,
  };
}

const ALICE = '0xa11ce00000000000000000000000000000000001';
const BOB = '0xb0b0000000000000000000000000000000000002';
const CAROL = '0xca401000000000000000000000000000000000003';
const DAVE = '0xda7e0000000000000000000000000000000000004';
const EVE = '0xe7e00000000000000000000000000000000000005';

export const initialMembers: Member[] = [
  member(YOU, 'You', '0x9a9a000000000000000000000000000000000001', 25_000, 'Rebalance between ETH and USDC to keep a 50/50 split. Rebalance only when drift exceeds 5%. Uniswap only.', 30),
  member(ALICE, 'alice.base.eth', '0x9a9a000000000000000000000000000000000002', 10_000, 'Trade only ETH/USDC on Uniswap v3 or Aerodrome. Max 5% of portfolio per trade. Max 1% slippage. Never hold more than 60% in ETH.', 40),
  member(BOB, 'bob.base.eth', '0x9a9a000000000000000000000000000000000003', 30_000, 'Weekly DCA into cbBTC with 10% of USDC balance every Monday. No other trades. No leverage.', 60),
  member(CAROL, 'carol.base.eth', '0x9a9a000000000000000000000000000000000004', 100_000, 'Market-neutral basis trade on ETH perps, max 2x leverage.', 90),
  member(DAVE, 'dave.base.eth', '0x9a9a000000000000000000000000000000000005', 60_000, 'Stablecoin yield only: USDC lending on Aave and Morpho. No volatile assets.', 75),
  // Removed after a fraud verdict; kept so old claims can show the name.
  { ...member(EVE, 'eve.base.eth', '0x9a9a000000000000000000000000000000000006', 0, 'Only trade blue-chip tokens.', 50), active: false },
];

const TOTAL = 225_000;

function claim(partial: Partial<Claim> & Pick<Claim, 'id' | 'claimant' | 'requested' | 'txHash'>): Claim {
  const m = initialMembers.find((x) => x.address === partial.claimant)!;
  return {
    agent: m.agent,
    strategyHash: m.strategyHash,
    revealedStrategy: m.strategyText,
    summary: '',
    lossLines: [],
    createdAt: now - DAY,
    votingEnds: now + 2 * DAY,
    status: 'open',
    approve: 0,
    reject: 0,
    fraud: 0,
    totalStakeSnapshot: TOTAL,
    payout: 0,
    ballots: {},
    ...partial,
  };
}

export const initialClaims: Claim[] = [
  claim({
    id: 5,
    claimant: ALICE,
    requested: 4_200,
    txHash: '0x7f3c1e9a0b2d4c6e8f1a3b5c7d9e0f2a4b6c8d0e1f3a5b7c9d1e3f5a7b9c1d3e',
    summary:
      'My strategy only allows ETH/USDC trades. The agent swapped 2 ETH into PEPE on a low-liquidity pool, which breaks the "ETH/USDC only" rule and the 1% slippage limit.',
    lossLines: [
      { direction: 'out', token: 'ETH', amount: 2, priceUsd: 3_100 },
      { direction: 'in', token: 'PEPE', amount: 200_000_000, priceUsd: 0.00001 },
    ],
    createdAt: now - 1.5 * DAY,
    votingEnds: now + 1.5 * DAY,
    approve: 30_000,
    ballots: { [BOB]: { vote: 'approve', weight: 30_000 } },
  }),
  claim({
    id: 4,
    claimant: BOB,
    requested: 12_000,
    txHash: '0x2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a',
    summary: 'Agent bought a token outside my DCA plan on a Tuesday. The token went to zero shortly after.',
    lossLines: [
      { direction: 'out', token: 'USDC', amount: 12_000, priceUsd: 1 },
      { direction: 'in', token: 'XYZ', amount: 4_000_000, priceUsd: 0 },
    ],
    createdAt: now - 0.5 * DAY,
    votingEnds: now + 2.5 * DAY,
    reject: 60_000,
    ballots: { [DAVE]: { vote: 'reject', weight: 60_000 } },
  }),
  claim({
    id: 3,
    claimant: DAVE,
    requested: 2_500,
    txHash: '0x9e8d7c6b5a4938271605f4e3d2c1b0a99e8d7c6b5a4938271605f4e3d2c1b0a9',
    summary: 'Agent moved 2,500 USDC into an unaudited lending vault not in my allowlist (Aave, Morpho). The vault was drained.',
    lossLines: [{ direction: 'out', token: 'USDC', amount: 2_500, priceUsd: 1 }],
    createdAt: now - 6 * DAY,
    votingEnds: now - 3 * DAY,
    status: 'approved',
    approve: 125_000,
    reject: 30_000,
    payout: 2_000,
    ballots: {
      [YOU]: { vote: 'approve', weight: 25_000 },
      [CAROL]: { vote: 'approve', weight: 100_000 },
      [BOB]: { vote: 'reject', weight: 30_000 },
    },
  }),
  claim({
    id: 2,
    claimant: CAROL,
    requested: 8_000,
    txHash: '0x4455667788990011223344556677889900112233445566778899001122334455',
    summary: 'Agent opened a 2.4x leveraged position, above my 2x maximum, and was liquidated.',
    lossLines: [{ direction: 'out', token: 'USDC', amount: 8_000, priceUsd: 1 }],
    createdAt: now - 12 * DAY,
    votingEnds: now - 9 * DAY,
    status: 'rejected',
    approve: 30_000,
    reject: 85_000,
  }),
  claim({
    id: 1,
    claimant: EVE,
    requested: 9_000,
    txHash: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    summary: 'Agent bought a token that is not blue-chip.',
    lossLines: [
      { direction: 'out', token: 'USDC', amount: 9_000, priceUsd: 1 },
      { direction: 'in', token: 'EVE', amount: 9_000_000, priceUsd: 0 },
    ],
    createdAt: now - 20 * DAY,
    votingEnds: now - 17 * DAY,
    status: 'fraud',
    fraud: 160_000,
    reject: 30_000,
  }),
];
