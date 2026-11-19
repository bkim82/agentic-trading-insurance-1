import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { isAddress } from 'viem';
import { usePool } from '../state/PoolContext';
import { date, duration, shortAddr, strategyHash, usd } from '../lib/format';
import { payoutFor } from '../lib/rules';
import { strategyRules } from '../lib/strategy';
import { JoinProgress } from '../components/JoinProgress';
import { StrategyChips } from '../components/ClaimBits';
import { useDemoMode } from '../state/DemoMode';
import { DEMO_AGENT, DEMO_STRATEGY } from '../state/DemoPool';

const STEPS = ['Agent', 'Strategy', 'Stake'] as const;
const REVIEW = STEPS.length;

export function Join() {
  const pool = usePool();
  const { demo } = useDemoMode();
  // Demo mode prefills the form so a presenter can just press continue.
  const [agent, setAgent] = useState(demo ? DEMO_AGENT : '');
  const [strategy, setStrategy] = useState(demo ? DEMO_STRATEGY : '');
  const [amount, setAmount] = useState(demo ? '1' : '');
  const [step, setStep] = useState(0);
  const [moved, setMoved] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Move focus to the new question after Back/Continue, not on first load.
  useEffect(() => {
    if (moved) headingRef.current?.focus();
  }, [step, moved]);

  if (pool.me) {
    return (
      <>
        <h1>{pool.now >= pool.me.coveredFrom ? "You're covered" : "You're in"}</h1>
        <JoinProgress stake={pool.me.stake} />
        <p>
          See <Link to="/account">your account</Link> or <Link to="/claims">vote on claims</Link>.
        </p>
      </>
    );
  }

  if (!pool.isConnected) {
    return (
      <>
        <h1>Join the pool</h1>
        <p>Connect your browser wallet to join.</p>
        <button type="button" className="button" onClick={() => void pool.connect()}>
          Connect wallet
        </button>
      </>
    );
  }

  const { minStake, waitingPeriodMs } = pool.params;
  const stake = Number(amount || 0);
  const rules = strategyRules(strategy);
  const agentTaken = pool.members.some((m) => m.active && m.agent.toLowerCase() === agent.toLowerCase());
  const agentError =
    agent && !isAddress(agent) ? 'Not a valid address.' : agentTaken ? 'This agent is already registered.' : null;
  const stakeError =
    amount && stake < minStake
      ? `Minimum stake is ${usd(minStake)}.`
      : stake > pool.usdcBalance
        ? `You have ${usd(pool.usdcBalance)} USDC. Use "Get test funds" at the top to get more.`
        : null;
  const valid = [!!agent && !agentError, strategy.trim().length > 0, stake >= minStake && !stakeError];
  const canSubmit = valid.every(Boolean) && !pool.busy;
  const coverageStarts = pool.now + waitingPeriodMs;
  // After you join, your stake is part of the pool the 10% cap is measured against.
  const maxPayout = stake > 0 ? payoutFor(Infinity, stake, pool.poolAssets + stake).payout : 0;
  const picks = [...new Set([minStake, 0.5, 1, 2])].filter((v) => v >= minStake);

  const goTo = (n: number) => {
    setMoved(true);
    setStep(n);
  };

  return (
    <>
      <h1>Join the pool</h1>
      <p className="lede">
        Register your trading bot and commit to the strategy it must follow. If it breaks that strategy and loses money,
        you can file a claim.
      </p>

      <div className="wizard">
        <ol className="wiz-bar" aria-label="Progress">
          {STEPS.map((label, i) => (
            <li key={label} className={i < step ? 'done' : i === step ? 'on' : ''}>
              <span className="sr-only">
                {label}
                {i < step ? ' (done)' : i === step ? ' (current)' : ''}
              </span>
            </li>
          ))}
        </ol>
        <p className="muted small wiz-count">{step < REVIEW ? `Step ${step + 1} of ${STEPS.length}` : 'Review'}</p>

        <form
          className="stack wiz-step"
          key={step}
          onSubmit={(e) => {
            e.preventDefault();
            if (step < REVIEW) {
              if (valid[step]) goTo(step + 1);
            } else if (canSubmit) {
              void pool.join(agent, strategy.trim(), stake);
            }
          }}
        >
          {step === 0 && (
            <>
              <h2 className="wiz-q" ref={headingRef} tabIndex={-1} id="wiz-q">
                Which wallet does your bot trade from?
              </h2>
              <input
                className="mono"
                aria-labelledby="wiz-q"
                placeholder="0x…"
                value={agent}
                onChange={(e) => setAgent(e.target.value.trim())}
              />
              <span className="hint">One bot per member. Claims are checked against trades sent from this wallet.</span>
              {agentError ? (
                <p className="warn">{agentError}</p>
              ) : (
                agent && <p className="pos small">✓ Valid address, not registered yet</p>
              )}
            </>
          )}

          {step === 1 && (
            <>
              <h2 className="wiz-q" ref={headingRef} tabIndex={-1} id="wiz-q">
                What rules must your bot follow?
              </h2>
              <textarea
                rows={5}
                aria-labelledby="wiz-q"
                placeholder="e.g. Trade only ETH/USDC on Uniswap. Max 5% of portfolio per trade. Max 1% slippage."
                value={strategy}
                onChange={(e) => setStrategy(e.target.value)}
              />
              <span className="hint">
                Be specific: allowed tokens, venues, position sizes, slippage, leverage. Vague rules are hard to win
                claims on.
              </span>
              {rules.length > 0 && (
                <>
                  <StrategyChips text={strategy} />
                  <p className="pos small">
                    {rules.length} {rules.length === 1 ? 'rule' : 'rules'} found
                  </p>
                </>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <h2 className="wiz-q" ref={headingRef} tabIndex={-1} id="wiz-q">
                How much do you want to stake?
              </h2>
              <input
                type="number"
                aria-labelledby="wiz-q"
                min={minStake}
                step="0.01"
                placeholder={`${minStake} or more`}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <div className="chips" role="group" aria-label="Quick amounts">
                {picks.map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={stake === v ? 'chip chip-toggle chip-on' : 'chip chip-toggle'}
                    aria-pressed={stake === v}
                    onClick={() => setAmount(String(v))}
                  >
                    {usd(v)}
                  </button>
                ))}
              </div>
              <span className="hint">
                USDC, in USD. Your stake caps what one claim can pay you. You have {usd(pool.usdcBalance)}.
              </span>
              {stakeError ? (
                <p className="warn">{stakeError}</p>
              ) : (
                stake >= minStake && (
                  <p className="pos small">A claim could pay you up to {usd(maxPayout)} after you join.</p>
                )
              )}
            </>
          )}

          {step === REVIEW && (
            <>
              <h2 className="wiz-q" ref={headingRef} tabIndex={-1}>
                Check and join
              </h2>
              <dl className="wiz-review">
                <div>
                  <dt>Bot wallet</dt>
                  <dd className="mono">{shortAddr(agent)}</dd>
                  <button type="button" className="link-button" onClick={() => goTo(0)}>
                    Edit
                  </button>
                </div>
                <div>
                  <dt>Rules</dt>
                  <dd>
                    <StrategyChips text={strategy} />
                  </dd>
                  <button type="button" className="link-button" onClick={() => goTo(1)}>
                    Edit
                  </button>
                </div>
                <div>
                  <dt>Stake</dt>
                  <dd>
                    {usd(stake)} <span className="muted small">· max payout {usd(maxPayout)}</span>
                  </dd>
                  <button type="button" className="link-button" onClick={() => goTo(2)}>
                    Edit
                  </button>
                </div>
                <div>
                  <dt>Coverage starts</dt>
                  <dd>
                    {date(coverageStarts)} <span className="muted small">({duration(waitingPeriodMs)} from now)</span>
                  </dd>
                </div>
              </dl>
              <p className="muted mono small">Fingerprint stored on-chain: {strategyHash(strategy.trim())}</p>
              <JoinProgress stake={stake} />
              <p className="muted small">
                To change your strategy later, you leave and rejoin, which restarts the wait.
              </p>
            </>
          )}

          <div className="wiz-actions">
            {step > 0 && (
              <button type="button" className="button button-ghost" onClick={() => goTo(step - 1)}>
                Back
              </button>
            )}
            {step < REVIEW ? (
              <button type="submit" className="button" disabled={!valid[step]}>
                Continue
              </button>
            ) : (
              <button type="submit" className="button" disabled={!canSubmit}>
                Stake {usd(stake)} and join
              </button>
            )}
          </div>
        </form>
      </div>
    </>
  );
}
