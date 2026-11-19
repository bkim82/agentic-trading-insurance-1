import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Address, Hash, PublicClient } from 'viem';
import { usePublicClient } from 'wagmi';
import { RoundTripReview } from '../components/RoundTripReview';
import { CHAIN } from '../lib/chain';
import { readRoundTrip, type RoundTrip } from '../lib/roundTrip';
import { usePool } from '../state/PoolContext';
import { StatusBadge, StrategyChips, TallyBar } from '../components/ClaimBits';
import { lossFromLines, outcomeFor, payoutFor, RULES, type VoteChoice } from '../lib/rules';
import { date, pct, price, shortAddr, STATUS_LABEL, strategyHash, timeLeft, usd, VOTE_LABEL } from '../lib/format';
import type { Claim } from '../lib/types';
import { EXPLORER } from '../lib/chain';

const VOTE_HELP: Record<VoteChoice, string> = {
  approve: 'The transactions broke the committed strategy and the loss is supported.',
  reject: 'The trades were allowed by the strategy, or the amount is wrong.',
  fraud: 'The claimant staged the loss (for example, sent funds to a token or wallet they control).',
};

export function ClaimDetail() {
  const { id } = useParams();
  // Keyed by id so a half-chosen vote resets when moving between claims.
  return <ClaimDetailBody key={id} id={Number(id)} />;
}

function ClaimDetailBody({ id }: { id: number }) {
  const pool = usePool();
  const [choice, setChoice] = useState<VoteChoice | null>(null);

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
      </p>

      <div className="two-col">
        <section>
          <h2>What happened</h2>
          <p>{claim.summary}</p>

          <h3>Committed strategy</h3>
          <StrategyChips text={claim.revealedStrategy} broken={claim.brokenRules} />
          <details className="exact-text">
            <summary>Exact text</summary>
            <blockquote>{claim.revealedStrategy}</blockquote>
          </details>
          <p className={hashMatches ? 'ok' : 'warn'}>
            {hashMatches
              ? 'This text matches the strategy fingerprint committed on-chain.'
              : 'This text does not match the committed fingerprint. Treat the claim with suspicion.'}
          </p>

          {claim.sellTxHash ? (
            <PairEvidence claim={claim} coveredFrom={claimant?.coveredFrom ?? 0} />
          ) : (
            <>
              <h3>Transaction</h3>
              <p className="mono"><a href={`${EXPLORER}/tx/${claim.txHash}`} target="_blank" rel="noreferrer">{shortAddr(claim.txHash)}</a></p>
              <p className="muted">Agent: {claim.agent}</p>
              <h3>Claimant-supplied loss lines (legacy claim)</h3>
              <table className="table">
                <thead><tr><th>Direction</th><th>Token</th><th className="num">Amount</th><th className="num">Price at trade</th><th className="num">Value</th></tr></thead>
                <tbody>
                  {claim.lossLines.map((l, i) => (
                    <tr key={i}>
                      <td>{l.direction === 'out' ? 'Left wallet' : 'Came back'}</td>
                      <td>{l.token}</td>
                      <td className="num">{l.amount.toLocaleString()}</td>
                      <td className="num">{price(l.priceUsd)}</td>
                      <td className="num">{l.direction === 'out' ? '' : '−'}{usd(l.amount * l.priceUsd)}</td>
                    </tr>
                  ))}
                  <tr className="total-row"><td colSpan={4}>Claimant's calculated loss</td><td className="num">{usd(computedLoss)}</td></tr>
                </tbody>
              </table>
              {Math.abs(computedLoss - claim.requested) > 0.01 && <p className="warn">Requested amount ({usd(claim.requested)}) differs from the claimant's calculation ({usd(computedLoss)}).</p>}
            </>
          )}

          <h3>Before you vote, check</h3>
          <ul className="checklist">
            <li>Check {claim.sellTxHash ? 'both agent transactions and coverage dates' : 'the agent transaction and coverage date'}.</li>
            <li>Compare the trades with the actual rule in the committed strategy; this is not automatic.</li>
            <li>Check the prices, trade counterparties, and whether the claimant controls the destination.</li>
          </ul>
        </section>

        <aside className="panel">
          <h2>Money</h2>
          <dl className="kv">
            <dt>Requested</dt>
            <dd>{usd(claim.requested)}</dd>
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
          {claim.status === 'open' && <p className="muted">If voting ended now: {STATUS_LABEL[outcomeFor(claim)]}.</p>}

          {votingOpen && (
            <VotePanel
              claim={claim}
              choice={choice}
              onChoose={setChoice}
              onSubmit={() => {
                if (choice) void pool.vote(claim.id, choice);
              }}
            />
          )}

          {canResolve && (
            <>
              <p>Voting has ended.</p>
              <p className="muted small">Anyone can do this. It applies the outcome on-chain.</p>
              <button
                type="button"
                className="button"
                disabled={!!pool.busy}
                onClick={() => void pool.resolve(claim.id)}
              >
                Close voting and resolve
              </button>
            </>
          )}

          {claim.status !== 'open' && ballot && <VoteResult claim={claim} vote={ballot.vote} />}
        </aside>
      </div>
    </>
  );
}

function PairEvidence({ claim, coveredFrom }: { claim: Claim; coveredFrom: number }) {
  const client = usePublicClient({ chainId: CHAIN.id }) as PublicClient | undefined;
  const [result, setResult] = useState<{ pair?: RoundTrip; error?: string } | null>(null);
  useEffect(() => {
    if (!client || !claim.sellTxHash) return;
    let cancelled = false;
    void readRoundTrip(client, claim.txHash as Hash, claim.sellTxHash as Hash, claim.agent as Address, coveredFrom)
      .then((pair) => { if (!cancelled) setResult({ pair }); })
      .catch((e: unknown) => { if (!cancelled) setResult({ error: e instanceof Error ? e.message : String(e) }); });
    return () => { cancelled = true; };
  }, [client, claim.txHash, claim.sellTxHash, claim.agent, coveredFrom]);
  const pair = result?.pair;
  return (
    <>
      <p className="muted">Registered agent: {claim.agent}</p>
      {!result && <p className="muted">Verifying buy and sell transactions…</p>}
      {result?.error && <p className="warn" role="alert">Could not verify the round trip: {result.error}. Do not approve based on the claimant's amount alone.</p>}
      {pair && claim.sellTxHash && (
        <>
          <RoundTripReview pair={pair} buyHash={claim.txHash} sellHash={claim.sellTxHash} />
          {Math.abs(Number(pair.loss.toFixed(6)) - claim.requested) > 0.000001 && (
            <p className="warn" role="alert">On-chain requested amount ({usd(claim.requested)}) differs from the amount recalculated from the trades ({usd(pair.loss)}). Do not approve without investigating.</p>
          )}
          {pair.loss === 0 && <p className="warn">No realized loss was found in this pair.</p>}
        </>
      )}
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
  const { me, you, busy } = usePool();
  const ballot = claim.ballots[you];

  if (!me) {
    return (
      <p>
        <Link to="/join">Join the pool</Link> to vote on claims.
      </p>
    );
  }
  if (claim.claimant === you) return <p className="muted">You can't vote on your own claim.</p>;
  if (me.joinedAt >= claim.createdAt) {
    return <p className="muted">You joined after this claim was filed, so you can't vote on it.</p>;
  }
  if (ballot) {
    return (
      <p>
        You voted <strong>{VOTE_LABEL[ballot.vote]}</strong> with {usd(ballot.weight)} of stake.
      </p>
    );
  }

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
        Your vote counts with {usd(me.stake)} of stake. If you end up on the losing side (pay vs. don't pay), you lose{' '}
        {usd(me.stake * RULES.voterPenaltyPct)} ({pct(RULES.voterPenaltyPct)}) to the voters who got it right.
      </p>
      <button type="submit" className="button" disabled={!choice || !!busy}>
        Submit vote
      </button>
    </form>
  );
}

function VoteResult({ claim, vote }: { claim: Claim; vote: VoteChoice }) {
  if (claim.status === 'noQuorum') {
    return (
      <p className="muted">You voted {VOTE_LABEL[vote]}. Not enough members voted, so nobody gained or lost stake.</p>
    );
  }
  const won = (vote === 'approve') === (claim.status === 'approved');
  return (
    <p className="muted">
      You voted {VOTE_LABEL[vote]}.{' '}
      {won
        ? 'You were on the winning side and received a share of the losing voters’ penalty.'
        : `You were on the losing side and lost ${pct(RULES.voterPenaltyPct)} of your stake.`}
    </p>
  );
}
