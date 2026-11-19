import type { ClaimStatus, LossLine, VoteChoice } from './rules';

export interface Member {
  address: string;
  label: string;
  agent: string;
  strategyText: string;
  strategyHash: string;
  stake: number; // USD value
  joinedAt: number;
  coveredFrom: number;
  active: boolean;
}

export interface Ballot {
  vote: VoteChoice;
  weight: number;
}

export interface Claim {
  id: number;
  claimant: string;
  agent: string;
  strategyHash: string;
  revealedStrategy: string;
  txHash: string;
  sellTxHash?: string;
  requested: number;
  summary: string;
  lossLines: LossLine[];
  createdAt: number;
  votingEnds: number;
  status: ClaimStatus;
  approve: number;
  reject: number;
  fraud: number;
  totalStakeSnapshot: number;
  payout: number;
  ballots: Record<string, Ballot>;
}
