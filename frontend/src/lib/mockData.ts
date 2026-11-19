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
    strategyVersion: 1,
    stake,
    joinedAt,
    coveredFrom: joinedAt + RULES.waitingPeriodMs,
    active: true,
    banned: false,
  };
}

const ALICE_STRATEGY =
  'Trade only ETH/USDC on Uniswap v3 or Aerodrome. Max 5% of portfolio per trade. Max 1% slippage. Never hold more than 60% in ETH.';
const BOB_STRATEGY =
  'Weekly DCA into cbBTC with 10% of USDC balance every Monday. No other trades. No leverage.';

export const initialMembers: Member[] = [
  member(YOU, 'You', '0x9a9a000000000000000000000000000000000001', 25_000, 'Rebalance between ETH and USDC to keep a 50/50 split. Rebalance only when drift exceeds 5%. Uniswap only.', 30),
  member('0xa11ce00000000000000000000000000000000001', 'alice.base.eth', '0x9a9a000000000000000000000000000000000002', 10_000, ALICE_STRATEGY, 40),
  member('0xb0b0000000000000000000000000000000000002', 'bob.base.eth', '0x9a9a000000000000000000000000000000000003', 30_000, BOB_STRATEGY, 60),
  member('0xca401000000000000000000000000000000000003', 'carol.base.eth', '0x9a9a000000000000000000000000000000000004', 100_000, 'Market-neutral basis trade on ETH perps, max 2x leverage.', 90),
  member('0xda7e0000000000000000000000000000000000004', 'dave.base.eth', '0x9a9a000000000000000000000000000000000005', 60_000, 'Stablecoin yield only: USDC lending on Aave and Morpho. No volatile assets.', 75),
  {
    ...member('0xe7e00000000000000000000000000000000000005', 'eve.base.eth', '0x9a9a000000000000000000000000000000000006', 0, 'Only trade blue-chip tokens.', 50),
    active: false,
    banned: true,
  },
];

const TOTAL = 225_000;

function claim(partial: Partial<Claim> & Pick<Claim, 'id' | 'claimant' | 'requested'>): Claim {
  const m = initialMembers.find((x) => x.address === partial.claimant)!;
  return {
    agent: m.agent,
    strategyHash: m.strategyHash,
    strategyVersion: 1,
    revealedStrategy: m.strategyText,
    txHashes: [],
    bond: partial.requested * RULES.claimBondPct,
    summary: '',
    lossLines: [],
    createdAt: now - DAY,
    votingEnds: now + 2 * DAY,
    status: 'open',
    approve: 0,
    reject: 0,
    fraud: 0,
    payBonds: 0,
    noPayBonds: 0,
    totalStakeSnapshot: TOTAL,
    payout: 0,
    refileOf: null,
    refiled: false,
    ballots: {},
    ...partial,
  };
}

export const initialClaims: Claim[] = [
  claim({
    id: 5,
    claimant: '0xa11ce00000000000000000000000000000000001',
    requested: 4_200,
    txHashes: ['0x7f3c1e9a0b2d4c6e8f1a3b5c7d9e0f2a4b6c8d0e1f3a5b7c9d1e3f5a7b9c1d3e'],
    summary:
      'My strategy only allows ETH/USDC trades. The agent swapped 2 ETH into PEPE on a low-liquidity pool, which breaks the "ETH/USDC only" rule and the 1% slippage limit.',
    lossLines: [
      { direction: 'out', token: 'ETH', amount: 2, priceUsd: 3_100 },
      { direction: 'in', token: 'PEPE', amount: 200_000_000, priceUsd: 0.00001 },
    ],
    createdAt: now - 1.5 * DAY,
    votingEnds: now + 1.5 * DAY,
    approve: 30_000,
    payBonds: 300,
    ballots: { '0xb0b0000000000000000000000000000000000002': { vote: 'approve', weight: 30_000, bond: 300, settled: false } },
  }),
  claim({
    id: 4,
    claimant: '0xb0b0000000000000000000000000000000000002',
    requested: 12_000,
    txHashes: [
      '0x1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f809',
      '0x2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a',
    ],
    summary:
      'Agent bought a token outside my DCA plan on a Tuesday. The token went to zero shortly after. Two transactions: approval and swap.',
    lossLines: [
      { direction: 'out', token: 'USDC', amount: 12_000, priceUsd: 1 },
      { direction: 'in', token: 'XYZ', amount: 4_000_000, priceUsd: 0 },
    ],
    createdAt: now - 0.5 * DAY,
    votingEnds: now + 2.5 * DAY,
    reject: 60_000,
    noPayBonds: 600,
    ballots: { '0xda7e0000000000000000000000000000000000004': { vote: 'reject', weight: 60_000, bond: 600, settled: false } },
  }),
  claim({
    id: 3,
    claimant: '0xda7e0000000000000000000000000000000000004',
    requested: 2_500,
    txHashes: ['0x9e8d7c6b5a4938271605f4e3d2c1b0a99e8d7c6b5a4938271605f4e3d2c1b0a9'],
    summary: 'Agent moved 2,500 USDC into an unaudited lending vault not in my allowlist (Aave, Morpho). The vault was drained.',
    lossLines: [{ direction: 'out', token: 'USDC', amount: 2_500, priceUsd: 1 }],
    createdAt: now - 6 * DAY,
    votingEnds: now - 3 * DAY,
    status: 'approved',
    approve: 125_000,
    reject: 30_000,
    payBonds: 1_250,
    noPayBonds: 300,
    payout: 2_000,
    ballots: {
      [YOU]: { vote: 'approve', weight: 25_000, bond: 250, settled: false },
      '0xca401000000000000000000000000000000000003': { vote: 'approve', weight: 100_000, bond: 1_000, settled: true },
      '0xb0b0000000000000000000000000000000000002': { vote: 'reject', weight: 30_000, bond: 300, settled: true },
    },
  }),
  claim({
    id: 2,
    claimant: '0xca401000000000000000000000000000000000003',
    requested: 8_000,
    txHashes: ['0x4455667788990011223344556677889900112233445566778899001122334455'],
    summary: 'Agent opened a 2.4x leveraged position, above my 2x maximum, and was liquidated.',
    lossLines: [{ direction: 'out', token: 'USDC', amount: 8_000, priceUsd: 1 }],
    createdAt: now - 12 * DAY,
    votingEnds: now - 9 * DAY,
    status: 'rejected',
    approve: 30_000,
    reject: 85_000,
    payBonds: 300,
    noPayBonds: 850,
    ballots: {},
  }),
  claim({
    id: 1,
    claimant: '0xe7e00000000000000000000000000000000000005',
    requested: 9_000,
    txHashes: ['0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'],
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
    noPayBonds: 1_900,
    ballots: {},
  }),
];
