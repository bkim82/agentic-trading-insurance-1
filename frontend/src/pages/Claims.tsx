import { Link } from 'react-router-dom';
import { usePool } from '../state/PoolContext';
import { ClaimCard, StatusBadge } from '../components/ClaimBits';
import { date, usd } from '../lib/format';

/** Claims resolved in the last 30 minutes stay on screen as outcome cards. */
const RECENT_MS = 30 * 60_000;

export function Claims() {
  const { claims, memberOf, me, now } = usePool();
  // Recently resolved claims stay in the grid (same key) so the card flips to its outcome.
  const live = claims.filter((c) => c.status === 'open' || now - c.votingEnds < RECENT_MS);
  const closed = claims.filter((c) => c.status !== 'open');

  return (
    <>
      <div className="title-row">
        <h1>Claims</h1>
        {me && (
          <Link to="/claims/new" className="button">
            File a claim
          </Link>
        )}
      </div>

      <h2>{live.length > 0 && live.every((c) => c.status !== 'open') ? 'Recently resolved' : 'In voting'}</h2>
      {live.length === 0 ? (
        <p className="card muted empty">No claims are in voting.</p>
      ) : (
        <div className="card-grid">
          {live.map((c) => (
            <ClaimCard key={c.id} claim={c} />
          ))}
        </div>
      )}

      <h2>Closed</h2>
      {closed.length === 0 ? (
        <p className="card muted empty">No closed claims yet.</p>
      ) : (
        <div className="card table-card">
          <table className="table">
            <thead>
              <tr>
                <th>Claim</th>
                <th>Claimant</th>
                <th className="num">Requested</th>
                <th className="num">Paid</th>
                <th>Outcome</th>
                <th>Filed</th>
              </tr>
            </thead>
            <tbody>
              {closed.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link to={`/claims/${c.id}`}>#{c.id}</Link>
                  </td>
                  <td>{memberOf(c.claimant)?.label}</td>
                  <td className="num">{usd(c.requested)}</td>
                  <td className="num">{c.payout ? usd(c.payout) : '—'}</td>
                  <td>
                    <StatusBadge status={c.status} />
                  </td>
                  <td>{date(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
