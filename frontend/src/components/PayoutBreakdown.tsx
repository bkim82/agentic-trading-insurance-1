import { pct, usd } from '../lib/format';
import { payoutFor, RULES } from '../lib/rules';

/** The three payout limits side by side; the one that sets the payout is highlighted. */
export function PayoutBreakdown({ loss, stake, poolAssets }: { loss: number; stake: number; poolAssets: number }) {
  const p = payoutFor(loss, stake, poolAssets);
  const rows = [
    { key: 'coverage', label: `${pct(RULES.coveragePct)} of the loss`, value: p.covered },
    { key: 'stake', label: 'Your stake cap', value: p.stakeCap },
    { key: 'pool', label: `${pct(RULES.maxPoolPayoutPct)} of the pool cap`, value: p.poolCap },
  ];
  return (
    <div className="card payout-breakdown" aria-live="polite">
      {rows.map((r) => (
        <div key={r.key} className={r.key === p.limitedBy ? 'payout-row limit' : 'payout-row'}>
          <span>
            {r.label}
            {r.key === p.limitedBy && <span className="limit-tag">sets the payout</span>}
          </span>
          <span>{usd(r.value)}</span>
        </div>
      ))}
      <div className="payout-total">
        <span className="muted">You'd receive if approved</span>
        <strong key={p.payout} className="count-pop">
          {usd(p.payout)}
        </strong>
      </div>
    </div>
  );
}
