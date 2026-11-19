import type { ClaimStatus, LossLine, VoteChoice } from './rules';

export interface Member {
  address: string;
  label: string;
  agent: string;
  strategyText: string;
  strategyHash: string;
  strategyVersion: number;
  stake: number; // USD value, excluding voter bonds in escrow
  joinedAt: number;
  coveredFrom: number;
  active: boolean;
  banned: boolean;
}

export interface Ballot {
  vote: VoteChoice;
  weight: number;
  bond: number;
  settled: boolean;
}

export interface Claim {
  id: number;
  claimant: string;
  agent: string;
  strategyHash: string;
  strategyVersion: number;
  revealedStrategy: string;
  txHashes: string[];
  requested: number;
  bond: number;
  summary: string;
  lossLines: LossLine[];
  createdAt: number;
  votingEnds: number;
  status: ClaimStatus;
  approve: number;
  reject: number;
  fraud: number;
  payBonds: number;
  noPayBonds: number;
  totalStakeSnapshot: number;
  payout: number;
  refileOf: number | null;
  refiled: boolean;
  ballots: Record<string, Ballot>;
}
