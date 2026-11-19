import { Link } from 'react-router-dom';
import { usePool } from '../state/PoolContext';
import { StatusBadge, TallyBar } from '../components/ClaimBits';
import { date, timeLeft, usd } from '../lib/format';

export function Claims() {
  const { claims, memberOf, now, me, you } = usePool();
  const open = claims.filter((c) => c.status === 'open');
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

      <h2>In voting</h2>
      {open.length === 0 ? (
        <p className="muted">No claims are in voting.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Claim</th>
              <th>Claimant</th>
              <th className="num">Requested</th>
              <th>Votes</th>
              <th>Time</th>
              <th>Your vote</th>
            </tr>
          </thead>
          <tbody>
            {open.map((c) => {
              const ballot = c.ballots[you];
              return (
                <tr key={c.id}>
                  <td>
                    <Link to={`/claims/${c.id}`}>#{c.id}</Link>
                  </td>
                  <td>{memberOf(c.claimant)?.label}</td>
                  <td className="num">{usd(c.requested)}</td>
                  <td className="tally-cell">
                    <TallyBar claim={c} />
                  </td>
                  <td>{timeLeft(c.votingEnds, now)}</td>
                  <td>
                    {c.claimant === you ? (
                      <span className="muted">Your claim</span>
                    ) : ballot ? (
                      ballot.vote
                    ) : (
                      <Link to={`/claims/${c.id}`}>Vote</Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <h2>Closed</h2>
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
    </>
  );
}
