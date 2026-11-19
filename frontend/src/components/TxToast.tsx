import { useEffect } from 'react';
import { usePool } from '../state/PoolContext';
import { EXPLORER } from '../lib/chain';

const STAGES = ['wallet', 'pending', 'confirmed'] as const;

/** Bottom toast that follows a transaction: confirm in wallet → pending → confirmed. */
export function TxToast() {
  const { tx, dismissTx } = usePool();

  // Hide a confirmed transaction after a few seconds.
  useEffect(() => {
    if (tx?.stage !== 'confirmed') return;
    const id = setTimeout(dismissTx, 4_000);
    return () => clearTimeout(id);
  }, [tx, dismissTx]);

  if (!tx) return null;
  const current = STAGES.indexOf(tx.stage);
  const text =
    tx.stage === 'confirmed'
      ? tx.doneLabel
      : tx.stage === 'wallet'
        ? `${tx.label}: confirm in your wallet`
        : `${tx.label}…`;

  return (
    <div className="tx-toast" role="status" aria-live="polite">
      {tx.stage === 'confirmed' ? (
        <span className="tx-icon tx-done" aria-hidden="true">
          ✓
        </span>
      ) : (
        <span className="tx-icon tx-spin" aria-hidden="true" />
      )}
      <div className="tx-body">
        <div>{text}</div>
        <div className="tx-steps" aria-hidden="true">
          {STAGES.map((s, i) => (
            <i key={s} className={i < current || tx.stage === 'confirmed' ? 'ok' : i === current ? 'on' : undefined} />
          ))}
        </div>
      </div>
      {tx.hash && (
        <a href={`${EXPLORER}/tx/${tx.hash}`} target="_blank" rel="noreferrer">
          Basescan ↗
        </a>
      )}
      {tx.stage === 'confirmed' && (
        <button type="button" className="tx-close" aria-label="Dismiss" onClick={dismissTx}>
          ×
        </button>
      )}
    </div>
  );
}
