import { Link } from 'react-router-dom';
import { usePool } from '../state/PoolContext';
import { RULES } from '../lib/rules';
import { pct, usd } from '../lib/format';

export function Overview() {
  const { members, claims, poolAssets, me, openClaimCount } = usePool();
  const active = members.filter((m) => m.active);
  const paid = claims.filter((c) => c.status === 'approved').reduce((s, c) => s + c.payout, 0);

  return (
    <>
      <h1>Insurance for AI trading agents</h1>
      <p className="lede">
        Members stake into a shared pool and commit to the strategy their trading agent must follow. If an agent breaks
        that strategy and loses money, the owner files a claim and the pool votes on whether to pay.
      </p>

      <dl className="facts">
        <div>
          <dt>Pool size</dt>
          <dd>{usd(poolAssets)}</dd>
        </div>
        <div>
          <dt>Members</dt>
          <dd>{active.length}</dd>
        </div>
        <div>
          <dt>Claims in voting</dt>
          <dd>{openClaimCount}</dd>
        </div>
        <div>
          <dt>Paid out</dt>
          <dd>{usd(paid)}</dd>
        </div>
      </dl>

      <p>
        {me ? (
          <>
            You have {usd(me.stake)} staked. <Link to="/claims">Review open claims</Link> or{' '}
            <Link to="/claims/new">file a claim</Link>.
          </>
        ) : (
          <>
            <Link to="/join">Join the pool</Link> to get covered and vote on claims.
          </>
        )}
      </p>

      <h2>How it works</h2>
      <ol className="steps">
        <li>
          <strong>Join.</strong> Stake at least {usd(RULES.minStake)}, register your agent's address, and commit to your
          strategy. Coverage starts after a {RULES.waitingPeriodMs / 86_400_000} day wait.
        </li>
        <li>
          <strong>File a claim.</strong> Point to the transaction where your agent broke the strategy and state the loss:
          what left the wallet minus what came back, priced at that moment.
        </li>
        <li>
          <strong>Members vote</strong> for {RULES.votingPeriodMs / 86_400_000} days: approve, reject, or fraud. Voters on
          the losing side lose {pct(RULES.voterPenaltyPct)} of their stake to the voters who got it right.
        </li>
        <li>
          <strong>Outcome.</strong> At least {pct(RULES.quorumPct)} of the pool must vote. Approval needs more than half
          of the votes. A fraud verdict takes the claimant's whole stake.
        </li>
      </ol>

      <h2>Payout limits</h2>
      <p>An approved claim pays the smallest of:</p>
      <ul>
        <li>{pct(RULES.coveragePct)} of the loss (you absorb the rest)</li>
        <li>your own stake</li>
        <li>{pct(RULES.maxPoolPayoutPct)} of the pool</li>
      </ul>
    </>
  );
}
