import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { ClaimStatus, VoteChoice } from '../lib/rules';
import { lossFromLines, payoutFor, RULES, turnoutPct } from '../lib/rules';
import { pct, price, shortAddr, STATUS_LABEL, strategyHash, timeLeft, usd, VOTE_LABEL } from '../lib/format';
import { voteEligibility } from '../lib/voting';
import { EXPLORER } from '../lib/chain';
import type { Claim } from '../lib/types';
import { usePool } from '../state/PoolContext';

export function StatusBadge({ status }: { status: ClaimStatus }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABEL[status]}</span>;
}

/** Which way the votes cast lean, in plain words. */
function leaning(claim: Claim): string {
  const cast = claim.approve + claim.reject + claim.fraud;
  if (cast === 0) return 'no votes yet';
  const top = (['approve', 'reject', 'fraud'] as const).reduce((a, b) => (claim[b] > claim[a] ? b : a));
  if (claim[top] === cast) return `all ${top}`;
  return `leaning ${top}`;
}

/**
 * One bar: full width is the pool's total stake, coloured segments are stake that voted
 * approve / reject / fraud, and the tick marks the quorum line.
 */
export function TallyBar({ claim, showLegend = false }: { claim: Claim; showLegend?: boolean }) {
  const total = claim.totalStakeSnapshot || 1;
  const parts = [
    { key: 'approve', label: 'Approve', value: claim.approve },
    { key: 'reject', label: 'Reject', value: claim.reject },
    { key: 'fraud', label: 'Fraud', value: claim.fraud },
  ];
  const turnout = turnoutPct(claim);
  const quorumMet = turnout >= RULES.quorumPct;

  return (
    <div className="tally">
      <div
        className="tally-bar"
        role="img"
        aria-label={`${pct(turnout)} of stake voted, ${leaning(claim)}. Quorum is ${pct(RULES.quorumPct)}.`}
      >
        {parts.map((p) => (
          <span key={p.key} className={`tally-${p.key}`} style={{ width: `${(p.value / total) * 100}%` }} />
        ))}
        <i className="tally-quorum" style={{ left: `${RULES.quorumPct * 100}%` }} />
      </div>
      <div className="tally-status">
        <span>
          {pct(turnout)} voted · {leaning(claim)}
        </span>
        <span className={quorumMet ? 'pos' : undefined}>
          {quorumMet ? 'Quorum met' : `Needs ${pct(RULES.quorumPct)}`}
        </span>
      </div>
      {showLegend && (
        <div className="tally-legend">
          {parts
            .filter((p) => p.value > 0)
            .map((p) => (
              <span key={p.key}>
                <i className={`dot tally-${p.key}`} /> {p.label} {usd(p.value)}
              </span>
            ))}
        </div>
      )}
    </div>
  );
}

const VOTES: VoteChoice[] = ['approve', 'reject', 'fraud'];

/** Approve / Reject / Fraud buttons. Each one sends the vote; the wallet prompt is the confirmation. */
function VoteButtons({ claimId }: { claimId: number }) {
  const pool = usePool();
  return (
    <div className="vote-buttons" role="group" aria-label="Vote">
      {VOTES.map((v) => (
        <button
          key={v}
          type="button"
          className={`vote-btn vote-btn-${v}`}
          disabled={!!pool.busy}
          onClick={() => void pool.vote(claimId, v)}
        >
          {VOTE_LABEL[v]}
        </button>
      ))}
    </div>
  );
}

/** One open claim as a card: summary, vote buttons, and expandable evidence. */
export function ClaimCard({ claim }: { claim: Claim }) {
  const pool = usePool();
  const [expanded, setExpanded] = useState(false);
  const claimant = pool.memberOf(claim.claimant);
  const payout = payoutFor(claim.requested, claimant?.stake ?? 0, pool.poolAssets).payout;
  const eligibility = voteEligibility(claim, pool.me, pool.you, pool.now);
  const href = `/claims/${claim.id}`;
  const detailsId = `claim-details-${claim.id}`;

  return (
    <article className={expanded ? 'card claim-card expanded' : 'card claim-card'}>
      <header className="claim-card-head">
        <Link to={href} className="claim-card-title">
          Claim #{claim.id}
        </Link>
        <span className="muted small">{timeLeft(claim.votingEnds, pool.now)}</span>
      </header>
      <p className={expanded ? 'claim-card-summary full' : 'claim-card-summary'}>
        {claim.summary || 'No summary provided.'}
      </p>
      <p className="muted small claim-card-meta">
        {claimant?.label ?? shortAddr(claim.claimant)} · pays <strong>{usd(payout)}</strong> if approved
      </p>

      <TallyBar claim={claim} />

      {!expanded && eligibility.kind === 'can' && <VoteButtons claimId={claim.id} />}

      <button
        type="button"
        className="expand-toggle"
        aria-expanded={expanded}
        aria-controls={detailsId}
        onClick={() => setExpanded((x) => !x)}
      >
        {expanded ? 'Hide details' : 'Show details'}
        <span className="chevron" aria-hidden="true" />
      </button>

      {expanded && (
        <div id={detailsId} className="claim-details">
          <ClaimEvidence claim={claim} payout={payout} />
          {eligibility.kind === 'can' && (
            <>
              <p className="muted small">
                Voting with {usd(pool.me?.stake ?? 0)} of stake. The losing side loses {pct(RULES.voterPenaltyPct)} of
                stake.
              </p>
              <VoteButtons claimId={claim.id} />
            </>
          )}
        </div>
      )}

      {eligibility.kind === 'ended' && (
        <button
          type="button"
          className="button button-block"
          disabled={!!pool.busy}
          onClick={() => void pool.resolve(claim.id)}
        >
          Voting ended · resolve
        </button>
      )}
      {eligibility.kind === 'voted' && (
        <p className="claim-card-foot">
          You voted <strong className={`vote-${eligibility.vote}`}>{VOTE_LABEL[eligibility.vote]}</strong> ·{' '}
          <Link to={href}>Full claim</Link>
        </p>
      )}
      {eligibility.kind === 'blocked' && (
        <p className="claim-card-foot muted">
          {eligibility.reason} · <Link to={href}>Full claim</Link>
        </p>
      )}
    </article>
  );
}

/** What a voter should check: strategy and its fingerprint, the transaction, and the loss math. */
function ClaimEvidence({ claim, payout }: { claim: Claim; payout: number }) {
  const hashMatches = strategyHash(claim.revealedStrategy) === claim.strategyHash;
  const loss = lossFromLines(claim.lossLines);

  return (
    <>
      <h3>Committed strategy</h3>
      <blockquote>{claim.revealedStrategy || 'Not provided.'}</blockquote>
      <p className={hashMatches ? 'pos small' : 'neg small'}>
        {hashMatches ? '✓ Matches the on-chain fingerprint' : '✕ Does not match the on-chain fingerprint'}
      </p>

      <dl className="kv">
        <dt>Transaction</dt>
        <dd>
          <a href={`${EXPLORER}/tx/${claim.txHash}`} target="_blank" rel="noreferrer">
            {shortAddr(claim.txHash)}
          </a>
        </dd>
        {claim.lossLines.map((l, i) => (
          <KvRow
            key={i}
            label={`${l.direction === 'out' ? 'Left wallet' : 'Came back'} · ${l.amount.toLocaleString()} ${l.token} @ ${price(l.priceUsd)}`}
            value={`${l.direction === 'out' ? '' : '−'}${usd(l.amount * l.priceUsd)}`}
          />
        ))}
        <dt>
          <strong>Loss</strong>
        </dt>
        <dd>
          <strong>{usd(loss)}</strong>
        </dd>
        <dt>Pays if approved</dt>
        <dd>{usd(payout)}</dd>
      </dl>
    </>
  );
}

function KvRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}
