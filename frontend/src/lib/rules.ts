// Mirrors the constants and math in src/AgentInsurancePool.sol.
// When the frontend is wired to the contract, read these from the contract instead.

export const DAY = 24 * 60 * 60 * 1000;

export const RULES = {
  waitingPeriodMs: 7 * DAY,
  votingPeriodMs: 3 * DAY,
  voterPenaltyPct: 0.01, // losing voters lose 1% of their stake to the winners
  quorumPct: 0.2, // 20% of total stake must vote
  coveragePct: 0.8, // pays 80% of the loss
  maxPoolPayoutPct: 0.1, // a claim pays at most 10% of the pool
  minStake: 100,
} as const;

export type VoteChoice = 'approve' | 'reject' | 'fraud';
export type ClaimStatus = 'open' | 'approved' | 'rejected' | 'fraud' | 'noQuorum';

export interface LossLine {
  direction: 'out' | 'in';
  token: string;
  amount: number;
  priceUsd: number; // price at the block of the trade
}

/** Value out minus value in, priced at the trade's block. Never negative. */
export function lossFromLines(lines: LossLine[]): number {
  const total = lines.reduce((sum, l) => {
    const value = l.amount * l.priceUsd;
    return l.direction === 'out' ? sum + value : sum - value;
  }, 0);
  return Math.max(0, total);
}

export interface PayoutBreakdown {
  covered: number;
  stakeCap: number;
  poolCap: number;
  payout: number;
  limitedBy: 'coverage' | 'stake' | 'pool';
}

/** min(80% of requested, claimant stake, 10% of pool) */
export function payoutFor(requested: number, claimantStake: number, poolAssets: number): PayoutBreakdown {
  const covered = requested * RULES.coveragePct;
  const stakeCap = claimantStake;
  const poolCap = poolAssets * RULES.maxPoolPayoutPct;
  const payout = Math.min(covered, stakeCap, poolCap);
  const limitedBy = payout === covered ? 'coverage' : payout === stakeCap ? 'stake' : 'pool';
  return { covered, stakeCap, poolCap, payout, limitedBy };
}

export interface Tally {
  approve: number;
  reject: number;
  fraud: number;
  totalStakeSnapshot: number;
}

/** Outcome if voting ended right now, using the contract's rules. */
export function outcomeFor(t: Tally): Exclude<ClaimStatus, 'open'> {
  const cast = t.approve + t.reject + t.fraud;
  if (cast < t.totalStakeSnapshot * RULES.quorumPct) return 'noQuorum';
  if (t.approve * 2 > cast) return 'approved';
  if (t.fraud * 2 > cast) return 'fraud';
  return 'rejected';
}

export function turnoutPct(t: Tally): number {
  if (t.totalStakeSnapshot === 0) return 0;
  return (t.approve + t.reject + t.fraud) / t.totalStakeSnapshot;
}
