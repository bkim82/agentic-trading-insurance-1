import { Link } from 'react-router-dom';
import { usePool } from '../state/PoolContext';
import { ClaimCard } from '../components/ClaimBits';
import { payoutFor, RULES } from '../lib/rules';
import { duration, pct, timeLeft, usd } from '../lib/format';
import { voteEligibility } from '../lib/voting';

/** Claims resolved in the last 30 minutes stay on screen as outcome cards. */
const RECENT_MS = 30 * 60_000;

export function Overview() {
  const { members, claims, poolAssets, me, you, now, params } = usePool();
  const active = members.filter((m) => m.active).length;
  const paid = claims.filter((c) => c.status === 'approved').reduce((s, c) => s + c.payout, 0);
  const open = claims.filter((c) => c.status === 'open');
  const needsVote = open.filter((c) => voteEligibility(c, me, you, now).kind === 'can');
  const recent = claims.filter((c) => c.status !== 'open' && now - c.votingEnds < RECENT_MS);
  const shown = [...(needsVote.length > 0 ? needsVote : open), ...recent];
  const covered = me ? now >= me.coveredFrom : false;

  return (
    <>
      <div className="summary-grid">
        <section className="card">
          <p className="label">Pool</p>
          <p className="big-number">{usd(poolAssets)}</p>
          <p className="muted small">
            {active} {active === 1 ? 'member' : 'members'} · {usd(paid)} paid out
          </p>
        </section>

        <section className="card">
          <p className="label">Your coverage</p>
          {me ? (
            <>
              <p className="big-number">{usd(me.stake)}</p>
              <p className="muted small">
                {covered ? (
                  <span className="pos">● Active</span>
                ) : (
                  <span className="warn">● Starts in {timeLeft(me.coveredFrom, now).replace(' left', '')}</span>
                )}{' '}
                · max payout {usd(payoutFor(Infinity, me.stake, poolAssets).payout)}
              </p>
            </>
          ) : (
            <>
              <p className="big-number muted">Not covered</p>
              <Link to="/join" className="button button-small">
                Join the pool
              </Link>
            </>
          )}
        </section>
      </div>

      <div className="section-head">
        <h2>{needsVote.length > 0 ? 'Needs your vote' : open.length > 0 ? 'In voting' : 'Recently resolved'}</h2>
        <Link to="/claims">All claims</Link>
      </div>
      {shown.length > 0 ? (
        <div className="card-grid">
          {shown.map((c) => (
            <ClaimCard key={c.id} claim={c} />
          ))}
        </div>
      ) : (
        <p className="card muted empty">No claims are in voting right now.</p>
      )}

      <h2>How it works</h2>
      <ol className="steps-row">
        <li className="card">
          <strong>Join</strong>
          <span>Stake {usd(params.minStake)}+ and commit your agent's strategy.</span>
        </li>
        <li className="card">
          <strong>Wait</strong>
          <span>Coverage starts {duration(params.waitingPeriodMs)} after joining.</span>
        </li>
        <li className="card">
          <strong>Claim</strong>
          <span>Point to the trade that broke the strategy and the loss.</span>
        </li>
        <li className="card">
          <strong>Vote</strong>
          <span>
            {pct(RULES.quorumPct)} quorum; majority decides. Pays up to {pct(RULES.coveragePct)} of the loss.
          </span>
        </li>
      </ol>
    </>
  );
}
