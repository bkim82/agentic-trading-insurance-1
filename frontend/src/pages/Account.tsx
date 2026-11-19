import { Link, useNavigate } from 'react-router-dom';
import { usePool } from '../state/PoolContext';
import { RULES } from '../lib/rules';
import { pct, STATUS_LABEL, timeLeft, usd } from '../lib/format';

export function Account() {
  const pool = usePool();
  const navigate = useNavigate();

  const { me } = pool;
  if (!me) {
    return (
      <>
        <h1>My account</h1>
        <p>
          You're not a member. <Link to="/join">Join the pool</Link>.
        </p>
      </>
    );
  }

  const covered = pool.now >= me.coveredFrom;
  const myClaims = pool.claims.filter((c) => c.claimant === pool.you);
  const share = pool.poolAssets ? me.stake / pool.poolAssets : 0;
  const canLeave = pool.openClaimCount === 0;

  return (
    <>
      <h1>My account</h1>

      <dl className="facts">
        <div>
          <dt>Stake</dt>
          <dd>{usd(me.stake)}</dd>
        </div>
        <div>
          <dt>Share of pool</dt>
          <dd>{pct(share, 1)}</dd>
        </div>
        <div>
          <dt>Coverage</dt>
          <dd>{covered ? 'Active' : timeLeft(me.coveredFrom, pool.now)}</dd>
        </div>
        <div>
          <dt>Max payout per claim</dt>
          <dd>{usd(Math.min(me.stake, pool.poolAssets * RULES.maxPoolPayoutPct))}</dd>
        </div>
      </dl>

      <h2>Agent</h2>
      <p className="mono">{me.agent}</p>

      <h2>Strategy</h2>
      <blockquote>{me.strategyText}</blockquote>
      <p className="muted">To change your strategy, leave the pool and join again. Coverage restarts after the waiting period.</p>

      <h2>My claims</h2>
      {myClaims.length === 0 ? (
        <p className="muted">
          None. <Link to="/claims/new">File a claim</Link>
        </p>
      ) : (
        <ul>
          {myClaims.map((c) => (
            <li key={c.id}>
              <Link to={`/claims/${c.id}`}>Claim #{c.id}</Link>: {usd(c.requested)}, {STATUS_LABEL[c.status]}
            </li>
          ))}
        </ul>
      )}

      <h2>Leave the pool</h2>
      <p className="muted">Withdraw your full stake ({usd(me.stake)}) and end your coverage.</p>
      {!canLeave && (
        <p className="warn">You can leave once no claims are in voting, so nobody can exit to avoid paying a claim.</p>
      )}
      <button
        type="button"
        className="button button-secondary"
        disabled={!canLeave}
        onClick={() => {
          pool.leave();
          navigate('/');
        }}
      >
        Leave and withdraw
      </button>
    </>
  );
}
