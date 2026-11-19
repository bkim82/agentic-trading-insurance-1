import { useRef, useState, type Ref } from 'react';
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

/** Pill toggle for approve / reject / fraud, like a Buy / Sell switch. */
export function VoteToggle({
  value,
  onChange,
  disabled,
}: {
  value: VoteChoice | null;
  onChange: (v: VoteChoice) => void;
  disabled?: boolean;
}) {
  return (
    <div className="segmented" role="group" aria-label="Your vote">
      {VOTES.map((v) => (
        <button
          key={v}
          type="button"
          className={value === v ? `seg seg-on seg-${v}` : 'seg'}
          aria-pressed={value === v}
          disabled={disabled}
          onClick={() => onChange(v)}
        >
          {VOTE_LABEL[v]}
        </button>
      ))}
    </div>
  );
}

/** One open claim as a card: what it pays, where the vote stands, and the vote itself. */
export function ClaimCard({ claim }: { claim: Claim }) {
  const pool = usePool();
  const [choice, setChoice] = useState<VoteChoice | null>(null);
  const sheet = useRef<HTMLDialogElement>(null);
  const claimant = pool.memberOf(claim.claimant);
  const payout = payoutFor(claim.requested, claimant?.stake ?? 0, pool.poolAssets).payout;
  const eligibility = voteEligibility(claim, pool.me, pool.you, pool.now);
  const href = `/claims/${claim.id}`;

  return (
    <article className="card claim-card">
      <header className="claim-card-head">
        <Link to={href} className="claim-card-title">
          Claim #{claim.id}
        </Link>
        <span className="muted small">{timeLeft(claim.votingEnds, pool.now)}</span>
      </header>
      <p className="claim-card-summary">{claim.summary || 'No summary provided.'}</p>
      <p className="muted small claim-card-meta">
        {claimant?.label ?? shortAddr(claim.claimant)} · pays <strong>{usd(payout)}</strong> if approved
      </p>

      <TallyBar claim={claim} />

      {eligibility.kind === 'can' && (
        <>
          <VoteToggle value={choice} onChange={setChoice} disabled={!!pool.busy} />
          <button
            type="button"
            className="button button-block"
            disabled={!choice || !!pool.busy}
            onClick={() => sheet.current?.showModal()}
          >
            {choice ? `Review & confirm ${VOTE_LABEL[choice].toLowerCase()}` : 'Pick a vote'}
          </button>
          {choice && <EvidenceSheet ref={sheet} claim={claim} choice={choice} payout={payout} />}
        </>
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
          <Link to={href}>Details</Link>
        </p>
      )}
      {eligibility.kind === 'blocked' && (
        <p className="claim-card-foot muted">
          {eligibility.reason} · <Link to={href}>Details</Link>
        </p>
      )}
    </article>
  );
}

/** Modal with the evidence a voter should check before the wallet prompt. */
function EvidenceSheet({
  ref,
  claim,
  choice,
  payout,
}: {
  ref: Ref<HTMLDialogElement>;
  claim: Claim;
  choice: VoteChoice;
  payout: number;
}) {
  const pool = usePool();
  const hashMatches = strategyHash(claim.revealedStrategy) === claim.strategyHash;
  const loss = lossFromLines(claim.lossLines);
  const stake = pool.me?.stake ?? 0;

  return (
    <dialog ref={ref} className="sheet" aria-labelledby={`sheet-title-${claim.id}`}>
      <form method="dialog" className="sheet-body">
        <header className="sheet-head">
          <h2 id={`sheet-title-${claim.id}`}>Claim #{claim.id}</h2>
          <button type="submit" value="cancel" className="icon-button" aria-label="Close">
            ×
          </button>
        </header>

        <p>{claim.summary || 'No summary provided.'}</p>

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
            <FragmentRow
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

        <p className="muted small">
          Voting {VOTE_LABEL[choice]} with {usd(stake)} of stake. If you end up on the losing side you lose{' '}
          {usd(stake * RULES.voterPenaltyPct)} ({pct(RULES.voterPenaltyPct)}).
        </p>

        <div className="sheet-actions">
          <button type="submit" value="cancel" className="button button-ghost">
            Cancel
          </button>
          <button
            type="button"
            className="button"
            disabled={!!pool.busy}
            onClick={async (e) => {
              const dialog = e.currentTarget.closest('dialog');
              if (await pool.vote(claim.id, choice)) dialog?.close();
            }}
          >
            Confirm {VOTE_LABEL[choice].toLowerCase()}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function FragmentRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}
