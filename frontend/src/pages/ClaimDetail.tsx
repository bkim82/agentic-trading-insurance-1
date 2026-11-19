import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { usePool } from '../state/PoolContext';
import { StatusBadge, TallyBar } from '../components/ClaimBits';
import { lossFromLines, outcomeFor, payoutFor, RULES, type VoteChoice } from '../lib/rules';
import { date, pct, price, shortAddr, STATUS_LABEL, strategyHash, timeLeft, usd, VOTE_LABEL } from '../lib/format';
import type { Claim } from '../lib/types';

const VOTE_HELP: Record<VoteChoice, string> = {
  approve: 'The trade broke the committed strategy and the loss math is right.',
  reject: 'The trade was allowed by the strategy, or the amount is wrong.',
  fraud: 'The claimant staged the loss (for example, sent funds to a token or wallet they control).',
};

export function ClaimDetail() {
  const { id } = useParams();
  // Keyed by id so the vote and refile drafts reset when moving between claims.
  return <ClaimDetailBody key={id} id={Number(id)} />;
}

function ClaimDetailBody({ id }: { id: number }) {
  const navigate = useNavigate();
  const pool = usePool();
  const [choice, setChoice] = useState<VoteChoice | null>(null);
  const [refileAmount, setRefileAmount] = useState('');
  const [refileSummary, setRefileSummary] = useState('');

  const claim = pool.claims.find((c) => c.id === id);
  if (!claim) {
    return (
      <>
        <h1>Claim not found</h1>
        <Link to="/claims">Back to claims</Link>
      </>
    );
  }

  const claimant = pool.memberOf(claim.claimant);
  const hashMatches = strategyHash(claim.revealedStrategy) === claim.strategyHash;
  const computedLoss = lossFromLines(claim.lossLines);
  const votingOpen = claim.status === 'open' && pool.now < claim.votingEnds;
  const canResolve = claim.status === 'open' && pool.now >= claim.votingEnds;
  const preview = payoutFor(claim.requested, claimant?.stake ?? 0, pool.poolAssets);
  const ballot = claim.ballots[pool.you];

  return (
    <>
      <p className="crumb">
        <Link to="/claims">Claims</Link> / #{claim.id}
      </p>
      <div className="title-row">
        <h1>
          Claim #{claim.id} by {claimant?.label}
        </h1>
        <StatusBadge status={claim.status} />
      </div>
      <p className="muted">
        Filed {date(claim.createdAt)}
        {claim.status === 'open' && <> · {timeLeft(claim.votingEnds, pool.now)}</>}
        {claim.refileOf && (
          <>
            {' '}
            · Refile of <Link to={`/claims/${claim.refileOf}`}>#{claim.refileOf}</Link>
          </>
        )}
      </p>

      <div className="two-col">
        <section>
          <h2>What happened</h2>
          <p>{claim.summary}</p>

          <h3>Committed strategy (version {claim.strategyVersion})</h3>
          <blockquote>{claim.revealedStrategy}</blockquote>
          <p className={hashMatches ? 'ok' : 'warn'}>
            {hashMatches
              ? 'This text matches the strategy fingerprint committed on-chain.'
              : 'This text does not match the committed fingerprint. Treat the claim with suspicion.'}
          </p>

          <h3>Transactions</h3>
          <ul className="mono-list">
            {claim.txHashes.map((h) => (
              <li key={h}>
                <a href={`https://basescan.org/tx/${h}`} target="_blank" rel="noreferrer">
                  {shortAddr(h)}
                </a>
              </li>
            ))}
          </ul>
          <p className="muted">Agent: {claim.agent}</p>

          <h3>Loss: value out minus value in</h3>
          <table className="table">
            <thead>
              <tr>
                <th>Direction</th>
                <th>Token</th>
                <th className="num">Amount</th>
                <th className="num">Price at trade</th>
                <th className="num">Value</th>
              </tr>
            </thead>
            <tbody>
              {claim.lossLines.map((l, i) => (
                <tr key={i}>
                  <td>{l.direction === 'out' ? 'Left wallet' : 'Came back'}</td>
                  <td>{l.token}</td>
                  <td className="num">{l.amount.toLocaleString()}</td>
                  <td className="num">{price(l.priceUsd)}</td>
                  <td className="num">
                    {l.direction === 'out' ? '' : '−'}
                    {usd(l.amount * l.priceUsd)}
                  </td>
                </tr>
              ))}
              <tr className="total-row">
                <td colSpan={4}>Calculated loss</td>
                <td className="num">{usd(computedLoss)}</td>
              </tr>
            </tbody>
          </table>
          {Math.abs(computedLoss - claim.requested) > 0.01 && (
            <p className="warn">
              The requested amount ({usd(claim.requested)}) differs from the calculated loss ({usd(computedLoss)}).
            </p>
          )}

          <h3>Before you vote, check</h3>
          <ul className="checklist">
            <li>The transaction was sent from the registered agent address.</li>
            <li>It happened after coverage started and under this strategy version.</li>
            <li>The trade clearly breaks a rule in the committed strategy.</li>
            <li>The prices match market data at that block.</li>
            <li>Where the money went: a token or wallet tied to the claimant suggests fraud.</li>
          </ul>
        </section>

        <aside className="panel">
          <h2>Money</h2>
          <dl className="kv">
            <dt>Requested</dt>
            <dd>{usd(claim.requested)}</dd>
            <dt>Claim bond</dt>
            <dd>{usd(claim.bond)}</dd>
            {claim.status === 'approved' && (
              <>
                <dt>Paid</dt>
                <dd>{usd(claim.payout)}</dd>
              </>
            )}
          </dl>
          {claim.status === 'open' && <PayoutPreview preview={preview} />}

          <h2>Votes</h2>
          <TallyBar claim={claim} showLegend />
          {claim.status === 'open' && (
            <p className="muted">If voting ended now: {STATUS_LABEL[outcomeFor(claim)]}.</p>
          )}

          {votingOpen && (
            <VotePanel
              claim={claim}
              choice={choice}
              onChoose={setChoice}
              onSubmit={() => choice && pool.vote(claim.id, choice)}
            />
          )}

          {canResolve && (
            <>
              <p>Voting has ended.</p>
              <button type="button" className="button" onClick={() => pool.resolve(claim.id)}>
                Close voting and resolve
              </button>
            </>
          )}

          {claim.status !== 'open' && ballot && <SettlePanel claim={claim} onSettle={() => pool.settleVote(claim.id)} />}

          {claim.claimant === pool.you &&
            (claim.status === 'rejected' || claim.status === 'noQuorum') &&
            !claim.refiled &&
            claim.refileOf === null && (
              <form
                className="stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  const newId = pool.refileClaim(claim.id, Number(refileAmount), refileSummary || claim.summary);
                  navigate(`/claims/${newId}`);
                }}
              >
                <h2>Refile once</h2>
                <p className="muted">You can refile this claim one time, for example with a corrected amount.</p>
                <label>
                  New amount (USD)
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    required
                    value={refileAmount}
                    onChange={(e) => setRefileAmount(e.target.value)}
                  />
                </label>
                <label>
                  What changed
                  <textarea rows={3} value={refileSummary} onChange={(e) => setRefileSummary(e.target.value)} />
                </label>
                <button type="submit" className="button">
                  Refile (bond {usd(Number(refileAmount || 0) * RULES.claimBondPct)})
                </button>
              </form>
            )}
        </aside>
      </div>
    </>
  );
}

function PayoutPreview({ preview }: { preview: ReturnType<typeof payoutFor> }) {
  const rows = [
    { key: 'coverage', label: `${pct(RULES.coveragePct)} of loss`, value: preview.covered },
    { key: 'stake', label: "Claimant's stake", value: preview.stakeCap },
    { key: 'pool', label: `${pct(RULES.maxPoolPayoutPct)} of pool`, value: preview.poolCap },
  ];
  return (
    <>
      <p>
        Pays <strong>{usd(preview.payout)}</strong> if approved, the smallest of:
      </p>
      <ul className="caps">
        {rows.map((r) => (
          <li key={r.key} className={preview.limitedBy === r.key ? 'cap-active' : undefined}>
            <span>{r.label}</span>
            <span>{usd(r.value)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function VotePanel({
  claim,
  choice,
  onChoose,
  onSubmit,
}: {
  claim: Claim;
  choice: VoteChoice | null;
  onChoose: (c: VoteChoice) => void;
  onSubmit: () => void;
}) {
  const { me, you } = usePool();
  const ballot = claim.ballots[you];

  if (!me) {
    return (
      <p>
        <Link to="/join">Join the pool</Link> to vote on claims.
      </p>
    );
  }
  if (claim.claimant === you) return <p className="muted">You can't vote on your own claim.</p>;
  if (me.joinedAt >= claim.createdAt) return <p className="muted">You joined after this claim was filed, so you can't vote on it.</p>;
  if (ballot) {
    return (
      <p>
        You voted <strong>{VOTE_LABEL[ballot.vote]}</strong> with {usd(ballot.weight)} of stake. Bond held:{' '}
        {usd(ballot.bond)}.
      </p>
    );
  }

  const bond = me.stake * RULES.voterBondPct;
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <h3>Your vote</h3>
      <fieldset className="choices">
        <legend className="sr-only">Vote</legend>
        {(Object.keys(VOTE_HELP) as VoteChoice[]).map((v) => (
          <label key={v} className={choice === v ? 'choice selected' : 'choice'}>
            <input type="radio" name="vote" value={v} checked={choice === v} onChange={() => onChoose(v)} />
            <span>
              <strong>{VOTE_LABEL[v]}</strong>
              <span className="muted">{VOTE_HELP[v]}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <p className="muted">
        Your vote counts with {usd(me.stake)} of stake. It holds a bond of {usd(bond)}, which you lose if you end up on the
        losing side (pay vs. don't pay).
      </p>
      <button type="submit" className="button" disabled={!choice}>
        Submit vote
      </button>
    </form>
  );
}

function SettlePanel({ claim, onSettle }: { claim: Claim; onSettle: () => void }) {
  const { you } = usePool();
  const b = claim.ballots[you];
  if (!b) return null;

  let reward = 0;
  if (claim.status === 'noQuorum') {
    reward = b.bond;
  } else {
    const paid = claim.status === 'approved';
    if ((b.vote === 'approve') === paid) {
      const win = paid ? claim.payBonds : claim.noPayBonds;
      const lose = paid ? claim.noPayBonds : claim.payBonds;
      reward = b.bond + (win > 0 ? (b.bond * lose) / win : 0);
    }
  }

  if (b.settled) {
    return <p className="muted">Your vote ({VOTE_LABEL[b.vote]}) is settled.</p>;
  }
  return (
    <div className="stack">
      <h3>Settle your vote</h3>
      <p>
        You voted {VOTE_LABEL[b.vote]}.{' '}
        {reward > 0
          ? `You get back ${usd(reward)} (your ${usd(b.bond)} bond${reward > b.bond ? ' plus winnings' : ''}).`
          : `You were on the losing side, so your ${usd(b.bond)} bond goes to the winners.`}
      </p>
      <button type="button" className="button" onClick={onSettle}>
        Settle
      </button>
    </div>
  );
}
