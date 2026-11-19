import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usePool } from '../state/PoolContext';
import { RULES } from '../lib/rules';
import { date, pct, timeLeft, usd, VOTE_LABEL } from '../lib/format';

export function Account() {
  const pool = usePool();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

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
  const unsettled = pool.claims.filter((c) => c.status !== 'open' && c.ballots[pool.you] && !c.ballots[pool.you].settled);
  const hasOpenClaim = myClaims.some((c) => c.status === 'open');
  const share = pool.totalStake ? me.stake / pool.totalStake : 0;

  const leaveBlocker =
    pool.openClaimCount > 0
      ? 'You can leave once no claims are in voting, so nobody can exit to avoid paying a claim.'
      : unsettled.length > 0
        ? 'Settle your votes first.'
        : null;

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

      <h2>Strategy (version {me.strategyVersion})</h2>
      {editing ? (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            pool.updateStrategy(draft.trim());
            setEditing(false);
          }}
        >
          <label>
            New strategy
            <textarea rows={5} value={draft} onChange={(e) => setDraft(e.target.value)} />
          </label>
          <p className="warn">
            Saving restarts your {RULES.waitingPeriodMs / 86_400_000} day waiting period. You won't be covered until{' '}
            {date(pool.now + RULES.waitingPeriodMs)}.
          </p>
          <div className="row">
            <button type="submit" className="button" disabled={!draft.trim()}>
              Save strategy
            </button>
            <button type="button" className="link-button" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <blockquote>{me.strategyText}</blockquote>
          <button
            type="button"
            className="link-button"
            disabled={hasOpenClaim}
            title={hasOpenClaim ? "You can't change your strategy while your claim is in voting." : undefined}
            onClick={() => {
              setDraft(me.strategyText);
              setEditing(true);
            }}
          >
            Change strategy
          </button>
        </>
      )}

      <h2>Votes to settle</h2>
      {unsettled.length === 0 ? (
        <p className="muted">Nothing to settle.</p>
      ) : (
        <ul>
          {unsettled.map((c) => (
            <li key={c.id}>
              <Link to={`/claims/${c.id}`}>Claim #{c.id}</Link>: you voted {VOTE_LABEL[c.ballots[pool.you].vote]}.{' '}
              <button type="button" className="link-button" onClick={() => pool.settleVote(c.id)}>
                Settle
              </button>
            </li>
          ))}
        </ul>
      )}

      <h2>My claims</h2>
      {myClaims.length === 0 ? (
        <p className="muted">
          None. <Link to="/claims/new">File a claim</Link>
        </p>
      ) : (
        <ul>
          {myClaims.map((c) => (
            <li key={c.id}>
              <Link to={`/claims/${c.id}`}>Claim #{c.id}</Link>: {usd(c.requested)}, {c.status}
            </li>
          ))}
        </ul>
      )}

      <h2>Leave the pool</h2>
      <p className="muted">Withdraw your full stake ({usd(me.stake)}) and end your coverage.</p>
      {leaveBlocker && <p className="warn">{leaveBlocker}</p>}
      <button
        type="button"
        className="button button-secondary"
        disabled={!!leaveBlocker}
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
