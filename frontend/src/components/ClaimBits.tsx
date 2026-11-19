import type { ClaimStatus } from '../lib/rules';
import { RULES, turnoutPct } from '../lib/rules';
import { pct, STATUS_LABEL, usd } from '../lib/format';
import type { Claim } from '../lib/types';

export function StatusBadge({ status }: { status: ClaimStatus }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABEL[status]}</span>;
}

/** Stacked bar of approve / reject / fraud weight, with the quorum line marked. */
export function TallyBar({ claim, showLegend = false }: { claim: Claim; showLegend?: boolean }) {
  const total = claim.totalStakeSnapshot || 1;
  const parts = [
    { key: 'approve', label: 'Approve', value: claim.approve },
    { key: 'reject', label: 'Reject', value: claim.reject },
    { key: 'fraud', label: 'Fraud', value: claim.fraud },
  ];
  const turnout = turnoutPct(claim);

  return (
    <div className="tally">
      <div
        className="tally-bar"
        role="img"
        aria-label={`Approve ${usd(claim.approve)}, reject ${usd(claim.reject)}, fraud ${usd(claim.fraud)}. Turnout ${pct(turnout)} of ${pct(RULES.quorumPct)} needed.`}
      >
        {parts.map((p) => (
          <span key={p.key} className={`tally-${p.key}`} style={{ width: `${(p.value / total) * 100}%` }} />
        ))}
        <span className="tally-quorum" style={{ left: `${RULES.quorumPct * 100}%` }} />
      </div>
      {showLegend && (
        <div className="tally-legend">
          {parts.map((p) => (
            <span key={p.key}>
              <i className={`dot tally-${p.key}`} /> {p.label} {usd(p.value)}
            </span>
          ))}
          <span className="muted">
            Turnout {pct(turnout)} (needs {pct(RULES.quorumPct)})
          </span>
        </div>
      )}
    </div>
  );
}
