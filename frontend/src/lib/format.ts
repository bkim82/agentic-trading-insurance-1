import { keccak256, toHex } from 'viem';
import type { ClaimStatus, VoteChoice } from './rules';

const usdFormat = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

export function usd(n: number): string {
  return usdFormat.format(n);
}

export function pct(n: number, digits = 0): string {
  return `${(n * 100).toFixed(digits)}%`;
}

export function shortAddr(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

export function strategyHash(text: string): `0x${string}` {
  return keccak256(toHex(text));
}

export function timeLeft(untilMs: number, nowMs: number): string {
  const ms = untilMs - nowMs;
  if (ms <= 0) return 'ended';
  const hours = Math.floor(ms / 3_600_000);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h left`;
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  if (hours > 0) return `${hours}h ${mins}m left`;
  const secs = Math.floor((ms % 60_000) / 1_000);
  return `${mins}m ${secs}s left`;
}

export function date(ms: number): string {
  return new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export const STATUS_LABEL: Record<ClaimStatus, string> = {
  open: 'Voting',
  approved: 'Approved',
  rejected: 'Rejected',
  fraud: 'Fraud',
  noQuorum: 'No quorum',
};

export const VOTE_LABEL: Record<VoteChoice, string> = {
  approve: 'Approve',
  reject: 'Reject',
  fraud: 'Fraud',
};

/** Token prices can be tiny (e.g. memecoins), so show significant digits below one cent. */
export function price(n: number): string {
  if (n === 0 || n >= 0.01) return usd(n);
  return `$${n.toPrecision(3)}`;
}

/** "2 minutes", "7 days" */
export function duration(ms: number): string {
  const units: [number, string][] = [
    [86_400_000, 'day'],
    [3_600_000, 'hour'],
    [60_000, 'minute'],
    [1_000, 'second'],
  ];
  for (const [size, name] of units) {
    if (ms >= size) {
      const n = Math.round(ms / size);
      return `${n} ${name}${n === 1 ? '' : 's'}`;
    }
  }
  return '0 seconds';
}
