import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Address, Hash, PublicClient } from 'viem';
import { usePublicClient } from 'wagmi';
import { RoundTripReview } from '../components/RoundTripReview';
import { CHAIN } from '../lib/chain';
import { date, duration, pct, timeLeft, usd } from '../lib/format';
import { readRoundTrip, type RoundTrip } from '../lib/roundTrip';
import { payoutFor, RULES } from '../lib/rules';
import { strategyRules } from '../lib/strategy';
import { usePool } from '../state/PoolContext';

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
type Lookup = { key: string; pair?: RoundTrip; error?: string };

export function FileClaim() {
  const pool = usePool();
  const navigate = useNavigate();
  const [buyHash, setBuyHash] = useState('');
  const [sellHash, setSellHash] = useState('');
  const [summary, setSummary] = useState('');
  const [brokenRules, setBrokenRules] = useState<string[]>([]);
  const [result, setResult] = useState<Lookup | null>(null);
  const client = usePublicClient({ chainId: CHAIN.id }) as PublicClient | undefined;
  const { me } = pool;
  const agent = me?.agent;
  const coveredFrom = me?.coveredFrom;
  const key = `${agent}:${coveredFrom}:${buyHash}:${sellHash}`;
  const validHashes = TX_HASH.test(buyHash) && TX_HASH.test(sellHash);

  useEffect(() => {
    if (!client || !agent || coveredFrom === undefined || !validHashes) return;
    let cancelled = false;
    void readRoundTrip(client, buyHash as Hash, sellHash as Hash, agent as Address, coveredFrom)
      .then((pair) => { if (!cancelled) setResult({ key, pair }); })
      .catch((e: unknown) => {
        if (!cancelled) setResult({ key, error: e instanceof Error ? e.message : String(e) });
      });
    return () => { cancelled = true; };
  }, [client, agent, coveredFrom, buyHash, sellHash, key, validHashes]);

  if (!me) {
    return <><h1>File a claim</h1><p>You need to be a member to file a claim. <Link to="/join">Join the pool</Link>.</p></>;
  }
  if (pool.now < me.coveredFrom) {
    return <><h1>File a claim</h1><p>Your coverage starts {date(me.coveredFrom)} ({timeLeft(me.coveredFrom, pool.now)}).</p></>;
  }
  const openClaim = pool.claims.find((c) => c.claimant === pool.you && c.status === 'open');
  if (openClaim) {
    return <><h1>File a claim</h1><p>You already have a claim in voting (<Link to={`/claims/${openClaim.id}`}>#{openClaim.id}</Link>). You can file another once it's resolved.</p></>;
  }

  const pair = result?.key === key ? result.pair : undefined;
  const error = result?.key === key ? result.error : undefined;
  const requested = pair ? Number(pair.loss.toFixed(6)) : 0;
  const preview = payoutFor(requested, me.stake, pool.poolAssets);
  const canSubmit = !!pair && requested > 0 && summary.trim().length > 0 && !pool.busy;

  return (
    <>
      <p className="crumb"><Link to="/claims">Claims</Link> / New</p>
      <h1>File a claim</h1>
      <p className="lede">Show the buy and sell your agent made, and explain which committed rule they broke. Members vote for {duration(pool.params.votingPeriodMs)}.</p>
      <form className="stack wide" onSubmit={(e) => {
        e.preventDefault();
        if (!pair || !canSubmit) return;
        void pool.fileClaim({ buyHash, sellHash, summary, requested, brokenRules }).then((id) => {
          if (id !== null) navigate(`/claims/${id}`);
        });
      }}>
        <h2>1. Committed strategy</h2>
        <blockquote>{me.strategyText}</blockquote>
        <p className="muted">This text is checked against your on-chain strategy fingerprint. Voters decide if these trades broke a rule.</p>

        <h2>2. Buy and sell transactions</h2>
        <p className="muted">Enter two successful transactions sent by your agent ({me.agent}), in order. The sell must close the full asset amount bought. Only ERC-20 to ERC-20 swaps can be calculated here.</p>
        <label>Buy transaction hash
          <input className="mono" placeholder="0x…" value={buyHash} onChange={(e) => setBuyHash(e.target.value.trim())} />
        </label>
        <label>Sell transaction hash
          <input className="mono" placeholder="0x…" value={sellHash} onChange={(e) => setSellHash(e.target.value.trim())} />
        </label>
        {buyHash && !TX_HASH.test(buyHash) && <p className="warn">Enter a valid buy transaction hash.</p>}
        {sellHash && !TX_HASH.test(sellHash) && <p className="warn">Enter a valid sell transaction hash.</p>}
        {validHashes && !pair && !error && <p className="muted">Reading both transactions and historical prices…</p>}
        {error && <p className="warn" role="alert">{error}</p>}
        {pair && <RoundTripReview pair={pair} buyHash={buyHash} sellHash={sellHash} />}

        <h2>3. Which strategy rule was broken?</h2>
        <p className="muted">Pick the rules from your committed strategy. Voters see them highlighted on your claim.</p>
        <div className="chips" role="group" aria-label="Rules broken">
          {strategyRules(me.strategyText).map((r) => {
            const on = brokenRules.includes(r);
            return (
              <button
                key={r}
                type="button"
                className={on ? 'chip chip-toggle chip-broken' : 'chip chip-toggle'}
                aria-pressed={on}
                onClick={() => setBrokenRules((rs) => (on ? rs.filter((x) => x !== r) : [...rs, r]))}
              >
                {r}
              </button>
            );
          })}
        </div>
        <label>Explanation for voters
          <textarea rows={4} placeholder="Quote the rule and explain how these transactions broke it." value={summary} onChange={(e) => setSummary(e.target.value)} />
        </label>

        <h2>4. Review claim</h2>
        <dl className="kv">
          <dt>Calculated realized loss</dt><dd>{pair ? usd(pair.loss) : '—'}</dd>
          <dt>Requested amount</dt><dd>{pair ? usd(requested) : '—'}</dd>
          <dt>Payout if approved</dt><dd>{pair ? <>{usd(preview.payout)} <span className="muted">({preview.limitedBy === 'coverage' ? `${pct(RULES.coveragePct)} of loss` : preview.limitedBy === 'stake' ? 'capped at your stake' : `capped at ${pct(RULES.maxPoolPayoutPct)} of pool`})</span></> : '—'}</dd>
        </dl>
        <p className="muted">The amounts are derived from transaction transfers and historical prices, not editable here. Voters still verify the strategy violation and counterparties; the current contract does not verify these calculations. Fraud can cost your entire stake.</p>
        <button type="submit" className="button" disabled={!canSubmit}>File claim</button>
      </form>
    </>
  );
}
