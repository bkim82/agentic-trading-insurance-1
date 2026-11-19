import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { ClaimStatus, VoteChoice } from '../lib/rules';
import { lossFromLines, payoutFor, RULES, turnoutPct } from '../lib/rules';
import { pct, price, shortAddr, STATUS_LABEL, strategyHash, timeLeft, usd, VOTE_LABEL } from '../lib/format';
import { voteEligibility } from '../lib/voting';
import { EXPLORER } from '../lib/chain';
import type { Claim } from '../lib/types';
import { sameRule, strategyRules } from '../lib/strategy';
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
        {/* "met" plays a one-time pulse when quorum is reached. */}
        <i className={quorumMet ? 'tally-quorum met' : 'tally-quorum'} style={{ left: `${RULES.quorumPct * 100}%` }} />
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

/** Strategy as chips; rules the claim says were broken are struck through in red. */
export function StrategyChips({ text, broken = [] }: { text: string; broken?: string[] }) {
  const rules = strategyRules(text);
  if (rules.length === 0) return <p className="muted small">No strategy provided.</p>;
  return (
    <ul className="chips" aria-label="Committed strategy rules">
      {rules.map((r) => {
        const isBroken = broken.some((b) => sameRule(b, r));
        return (
          <li key={r} className={isBroken ? 'chip chip-broken' : 'chip'}>
            {isBroken && <span className="sr-only">Broken: </span>}
            {r}
          </li>
        );
      })}
    </ul>
  );
}

/** Ring that empties as voting time runs out; turns orange in the last minute. */
export function CountdownRing({ end, total, now }: { end: number; total: number; now: number }) {
  const left = Math.max(0, end - now);
  const frac = total > 0 ? Math.min(1, left / total) : 0;
  const circumference = 2 * Math.PI * 14;
  const secs = Math.ceil(left / 1000);
  const label =
    secs >= 3600
      ? timeLeft(end, now).replace(' left', '')
      : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  return (
    <span className={left <= Math.min(60_000, total * 0.25) ? 'ring ring-urgent' : 'ring'} title={timeLeft(end, now)}>
      <svg viewBox="0 0 34 34" aria-hidden="true">
        <circle cx="17" cy="17" r="14" className="ring-track" />
        <circle
          cx="17"
          cy="17"
          r="14"
          className="ring-fill"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - frac)}
        />
      </svg>
      <span className="ring-label">{label}</span>
    </span>
  );
}

/** Approve / Reject / Fraud. Each sends the vote (the wallet prompt confirms); the pressed one fills while it's pending. */
function VoteButtons({ claimId }: { claimId: number }) {
  const pool = usePool();
  const [chosen, setChosen] = useState<VoteChoice | null>(null);
  return (
    <div className="vote-buttons" role="group" aria-label="Vote">
      {VOTES.map((v) => (
        <button
          key={v}
          type="button"
          className={`vote-btn vote-btn-${v}${chosen === v ? ' chosen' : chosen ? ' dim' : ''}`}
          aria-pressed={chosen === v}
          disabled={!!pool.busy}
          onClick={async () => {
            setChosen(v);
            if (!(await pool.vote(claimId, v))) setChosen(null);
          }}
        >
          {VOTE_LABEL[v]}
        </button>
      ))}
    </div>
  );
}

/** The result side of a resolved claim. */
function OutcomeFace({ claim }: { claim: Claim }) {
  const cast = claim.approve + claim.reject + claim.fraud;
  const approvePct = cast ? pct(claim.approve / cast) : '0%';
  const content: Record<Exclude<ClaimStatus, 'open'>, { tone: string; title: string; big: string; note: string }> = {
    approved: {
      tone: 'approved',
      title: '✓ Approved',
      big: `${usd(claim.payout)} paid`,
      note: `${approvePct} approve`,
    },
    rejected: { tone: 'neutral', title: 'Rejected', big: 'No payout', note: `${approvePct} approve · can be refiled` },
    fraud: { tone: 'fraud', title: '✕ Fraud', big: 'Stake slashed', note: "Claimant's stake went to the pool" },
    noQuorum: {
      tone: 'neutral',
      title: 'No quorum',
      big: 'No payout',
      note: 'Not enough members voted · can be refiled',
    },
  };
  const c = content[claim.status as Exclude<ClaimStatus, 'open'>];
  return (
    <div className={`outcome outcome-${c.tone}`}>
      <span className="outcome-title">{c.title}</span>
      <span className="outcome-big">{c.big}</span>
      <span className="muted small">{c.note}</span>
    </div>
  );
}

/** One claim as a card: summary, vote buttons and expandable evidence; flips to the outcome once resolved. */
export function ClaimCard({ claim }: { claim: Claim }) {
  const pool = usePool();
  const [expanded, setExpanded] = useState(false);
  // Remember whether it was open when it first appeared, so the flip only plays for a live resolution.
  const [wasOpen] = useState(claim.status === 'open');
  const claimant = pool.memberOf(claim.claimant);
  const payout = payoutFor(claim.requested, claimant?.stake ?? 0, pool.poolAssets).payout;
  const eligibility = voteEligibility(claim, pool.me, pool.you, pool.now);
  const href = `/claims/${claim.id}`;
  const detailsId = `claim-details-${claim.id}`;

  if (claim.status !== 'open') {
    return (
      <article className={wasOpen ? 'card claim-card resolved flip-in' : 'card claim-card resolved'}>
        <header className="claim-card-head">
          <Link to={href} className="claim-card-title">
            Claim #{claim.id}
          </Link>
          <span className="muted small">Resolved</span>
        </header>
        <OutcomeFace claim={claim} />
        <p className="muted small claim-card-meta">
          {claimant?.label ?? shortAddr(claim.claimant)} · requested {usd(claim.requested)}
        </p>
      </article>
    );
  }

  return (
    <article className={expanded ? 'card claim-card expanded' : 'card claim-card'}>
      <header className="claim-card-head">
        <Link to={href} className="claim-card-title">
          Claim #{claim.id}
        </Link>
        <CountdownRing end={claim.votingEnds} total={pool.params.votingPeriodMs} now={pool.now} />
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
        <p className="claim-card-foot fade-in">
          <span className="pos">✓</span> You voted{' '}
          <strong className={`vote-${eligibility.vote}`}>{VOTE_LABEL[eligibility.vote]}</strong> with{' '}
          {usd(eligibility.weight)} of stake · <Link to={href}>Full claim</Link>
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
      <StrategyChips text={claim.revealedStrategy} broken={claim.brokenRules} />
      <p className={hashMatches ? 'pos small' : 'neg small'}>
        {hashMatches ? '✓ Matches the on-chain fingerprint' : '✕ Does not match the on-chain fingerprint'}
      </p>

      <dl className="kv">
        <dt>{claim.sellTxHash ? 'Buy' : 'Transaction'}</dt>
        <dd>
          <a href={`${EXPLORER}/tx/${claim.txHash}`} target="_blank" rel="noreferrer">
            {shortAddr(claim.txHash)}
          </a>
        </dd>
        {claim.sellTxHash && (
          <>
            <dt>Sell</dt>
            <dd>
              <a href={`${EXPLORER}/tx/${claim.sellTxHash}`} target="_blank" rel="noreferrer">
                {shortAddr(claim.sellTxHash)}
              </a>
            </dd>
          </>
        )}
        {claim.lossLines.map((l, i) => (
          <KvRow
            key={i}
            label={`${l.direction === 'out' ? 'Left wallet' : 'Came back'} · ${l.amount.toLocaleString()} ${l.token} @ ${price(l.priceUsd)}`}
            value={`${l.direction === 'out' ? '' : '−'}${usd(l.amount * l.priceUsd)}`}
          />
        ))}
        <dt>
          <strong>{claim.sellTxHash ? 'Realized loss (claimed)' : 'Loss'}</strong>
        </dt>
        <dd>
          <strong>{usd(claim.sellTxHash ? claim.requested : loss)}</strong>
        </dd>
        <dt>Pays if approved</dt>
        <dd>{usd(payout)}</dd>
      </dl>
      {claim.sellTxHash && (
        <p className="muted small">The full claim page re-reads both trades and their prices to check this amount.</p>
      )}
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
