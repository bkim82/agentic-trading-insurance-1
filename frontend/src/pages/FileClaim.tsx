import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usePool } from '../state/PoolContext';
import { lossFromLines, payoutFor, RULES, type LossLine } from '../lib/rules';
import { date, duration, pct, timeLeft, usd } from '../lib/format';

interface LineDraft {
  id: number;
  direction: 'out' | 'in';
  token: string;
  amount: string;
  priceUsd: string;
}

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

let nextLineId = 3;

export function FileClaim() {
  const pool = usePool();
  const navigate = useNavigate();
  const [txHash, setTxHash] = useState('');
  const [summary, setSummary] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([
    { id: 1, direction: 'out', token: 'ETH', amount: '', priceUsd: '' },
    { id: 2, direction: 'in', token: '', amount: '', priceUsd: '' },
  ]);

  const { me } = pool;
  if (!me) {
    return (
      <>
        <h1>File a claim</h1>
        <p>
          You need to be a member to file a claim. <Link to="/join">Join the pool</Link>.
        </p>
      </>
    );
  }

  if (pool.now < me.coveredFrom) {
    return (
      <>
        <h1>File a claim</h1>
        <p>
          Your coverage starts {date(me.coveredFrom)} ({timeLeft(me.coveredFrom, pool.now)}). You can file claims for losses
          after that.
        </p>
      </>
    );
  }

  const openClaim = pool.claims.find((c) => c.claimant === pool.you && c.status === 'open');
  if (openClaim) {
    return (
      <>
        <h1>File a claim</h1>
        <p>
          You already have a claim in voting (<Link to={`/claims/${openClaim.id}`}>#{openClaim.id}</Link>). You can file
          another once it's resolved.
        </p>
      </>
    );
  }

  const txError = txHash && !TX_HASH.test(txHash) ? 'Not a valid transaction hash.' : null;

  const lossLines: LossLine[] = lines
    .filter((l) => l.token && l.amount !== '')
    .map((l) => ({
      direction: l.direction,
      token: l.token,
      amount: Number(l.amount),
      priceUsd: Number(l.priceUsd || 0),
    }));
  const loss = lossFromLines(lossLines);
  const preview = payoutFor(loss, me.stake, pool.poolAssets);
  const canSubmit = txHash !== '' && !txError && loss > 0 && summary.trim().length > 0;

  function updateLine(id: number, patch: Partial<LineDraft>) {
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  return (
    <>
      <p className="crumb">
        <Link to="/claims">Claims</Link> / New
      </p>
      <h1>File a claim</h1>
      <p className="lede">
        Show the pool that your agent broke your committed strategy, and how much it cost you. Members will vote for{' '}
        {duration(pool.params.votingPeriodMs)}.
      </p>

      <form
        className="stack wide"
        onSubmit={(e) => {
          e.preventDefault();
          void pool.fileClaim({ txHash, summary, lossLines, requested: loss }).then((id) => {
            if (id !== null) navigate(`/claims/${id}`);
          });
        }}
      >
        <h2>1. Your committed strategy</h2>
        <blockquote>{me.strategyText}</blockquote>
        <p className="muted">
          This text is shown to voters and checked against your on-chain fingerprint.
        </p>

        <h2>2. The transaction</h2>
        <label>
          Transaction hash
          <input
            className="mono"
            placeholder="0x…"
            value={txHash}
            onChange={(e) => setTxHash(e.target.value.trim())}
          />
        </label>
        {txError && <p className="warn">{txError}</p>}
        <p className="muted">It must be sent from your agent: {me.agent}</p>

        <h2>3. Why it breaks the strategy</h2>
        <label>
          Explanation for voters
          <textarea
            rows={4}
            placeholder="Which rule did the agent break, and how?"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
        </label>

        <h2>4. The loss</h2>
        <p className="muted">
          List what left the wallet and what came back, priced at the block of the trade. Later price moves don't count.
          Tokens with no market price count as zero.
        </p>
        <table className="table edit-table">
          <thead>
            <tr>
              <th>Direction</th>
              <th>Token</th>
              <th className="num">Amount</th>
              <th className="num">Price (USD)</th>
              <th className="num">Value</th>
              <th>
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td>
                  <select
                    aria-label="Direction"
                    value={l.direction}
                    onChange={(e) => updateLine(l.id, { direction: e.target.value as 'out' | 'in' })}
                  >
                    <option value="out">Left wallet</option>
                    <option value="in">Came back</option>
                  </select>
                </td>
                <td>
                  <input aria-label="Token" value={l.token} onChange={(e) => updateLine(l.id, { token: e.target.value })} />
                </td>
                <td>
                  <input
                    aria-label="Amount"
                    type="number"
                    min="0"
                    step="any"
                    value={l.amount}
                    onChange={(e) => updateLine(l.id, { amount: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    aria-label="Price in USD"
                    type="number"
                    min="0"
                    step="any"
                    value={l.priceUsd}
                    onChange={(e) => updateLine(l.id, { priceUsd: e.target.value })}
                  />
                </td>
                <td className="num">{usd(Number(l.amount || 0) * Number(l.priceUsd || 0))}</td>
                <td>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))}
                    disabled={lines.length <= 1}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            <tr className="total-row">
              <td colSpan={4}>Loss (value out minus value in)</td>
              <td className="num">{usd(loss)}</td>
              <td />
            </tr>
          </tbody>
        </table>
        <button
          type="button"
          className="link-button"
          onClick={() =>
            setLines((ls) => [...ls, { id: nextLineId++, direction: 'in', token: '', amount: '', priceUsd: '' }])
          }
        >
          Add a token
        </button>

        <h2>5. Review</h2>
        <dl className="kv">
          <dt>Requested amount</dt>
          <dd>{usd(loss)}</dd>
          <dt>Payout if approved</dt>
          <dd>
            {usd(preview.payout)}{' '}
            <span className="muted">
              (
              {preview.limitedBy === 'coverage'
                ? `${pct(RULES.coveragePct)} of the loss`
                : preview.limitedBy === 'stake'
                  ? 'capped at your stake'
                  : `capped at ${pct(RULES.maxPoolPayoutPct)} of the pool`}
              )
            </span>
          </dd>
        </dl>
        <p className="muted">
          Filing is free. If voters find fraud, you lose your whole stake.
        </p>
        <button type="submit" className="button" disabled={!canSubmit || !!pool.busy}>
          File claim
        </button>
      </form>
    </>
  );
}
