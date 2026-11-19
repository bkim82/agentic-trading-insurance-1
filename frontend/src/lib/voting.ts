import type { VoteChoice } from './rules';
import type { Claim, Member } from './types';

export type VoteEligibility =
  | { kind: 'can' }
  | { kind: 'voted'; vote: VoteChoice; weight: number }
  | { kind: 'ended' }
  | { kind: 'blocked'; reason: string };

/** Whether `you` can vote on `claim` right now, mirroring the contract's checks. */
export function voteEligibility(claim: Claim, me: Member | undefined, you: string, now: number): VoteEligibility {
  if (claim.status !== 'open') return { kind: 'blocked', reason: 'Closed' };
  if (now >= claim.votingEnds) return { kind: 'ended' };
  const ballot = you ? claim.ballots[you] : undefined;
  if (ballot) return { kind: 'voted', vote: ballot.vote, weight: ballot.weight };
  if (!me) return { kind: 'blocked', reason: 'Join the pool to vote' };
  if (claim.claimant === you) return { kind: 'blocked', reason: 'This is your claim' };
  if (me.joinedAt >= claim.createdAt) return { kind: 'blocked', reason: 'You joined after it was filed' };
  return { kind: 'can' };
}
