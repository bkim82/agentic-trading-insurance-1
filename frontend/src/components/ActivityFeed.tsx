import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { usePool } from '../state/PoolContext';
import { shortAddr, STATUS_LABEL, usd, VOTE_LABEL } from '../lib/format';
import type { ActivityItem } from '../lib/types';

function ago(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86_400)}d ago`;
}

/** Cents for normal amounts; sub-cent amounts keep their precision. */
const money = (n = 0) => usd(n >= 0.01 ? Math.round(n * 100) / 100 : n);

const ICON: Record<ActivityItem['kind'], string> = { joined: '+', left: '−', filed: '!', voted: '✓', resolved: '$' };

/** Latest pool events, newest first. New items slide in as the app polls. */
export function ActivityFeed({ limit = 6 }: { limit?: number }) {
  const { activity, you, now } = usePool();
  const who = (a?: string) =>
    a && a.toLowerCase() === you.toLowerCase() ? (
      <strong>You</strong>
    ) : (
      <span className="mono">{shortAddr(a ?? '')}</span>
    );
  const claim = (id?: number) => <Link to={`/claims/${id}`}>claim #{id}</Link>;

  const items = [...activity].sort((a, b) => b.at - a.at).slice(0, limit);
  if (items.length === 0) return <p className="card muted empty">No activity yet.</p>;

  return (
    <ul className="card feed">
      {items.map((e) => {
        let text: ReactNode;
        let tone: string = e.kind;
        switch (e.kind) {
          case 'joined':
            text = (
              <>
                {who(e.actor)} joined with {money(e.amount)} stake
              </>
            );
            break;
          case 'left':
            text = (
              <>
                {who(e.actor)} left and took back {money(e.amount)}
              </>
            );
            break;
          case 'filed':
            text = (
              <>
                {who(e.actor)} filed {claim(e.claimId)} for {money(e.amount)}
              </>
            );
            break;
          case 'voted':
            tone = `voted-${e.vote}`;
            text = (
              <>
                {who(e.actor)} voted <strong>{e.vote ? VOTE_LABEL[e.vote] : '?'}</strong> on {claim(e.claimId)} with{' '}
                {money(e.amount)}
              </>
            );
            break;
          case 'resolved':
            tone = `resolved-${e.status}`;
            text = (
              <>
                <strong>Claim #{e.claimId}</strong> {e.status ? STATUS_LABEL[e.status].toLowerCase() : 'resolved'}
                {e.status === 'approved' && <> · {money(e.amount)} paid</>} · {claim(e.claimId)}
              </>
            );
            break;
        }
        return (
          <li key={e.id} className="feed-item">
            <span className={`feed-icon feed-${tone}`} aria-hidden="true">
              {e.kind === 'voted' && e.vote === 'fraud'
                ? '✕'
                : e.kind === 'voted' && e.vote === 'reject'
                  ? '−'
                  : ICON[e.kind]}
            </span>
            <span className="feed-text">{text}</span>
            <time className="feed-time" dateTime={new Date(e.at).toISOString()}>
              {ago(e.at, now)}
            </time>
          </li>
        );
      })}
    </ul>
  );
}
