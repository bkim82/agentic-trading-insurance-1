import { useState } from 'react';
import { Link } from 'react-router-dom';
import { isAddress } from 'viem';
import { usePool } from '../state/PoolContext';
import { date, duration, strategyHash, usd } from '../lib/format';
import { JoinProgress } from '../components/JoinProgress';
import { StrategyChips } from '../components/ClaimBits';

export function Join() {
  const pool = usePool();
  const [agent, setAgent] = useState('');
  const [strategy, setStrategy] = useState('');
  const [amount, setAmount] = useState('');

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
  const agentTaken = pool.members.some((m) => m.active && m.agent.toLowerCase() === agent.toLowerCase());
  const agentError =
    agent && !isAddress(agent) ? 'Not a valid address.' : agentTaken ? 'This agent is already registered.' : null;
  const stakeError =
    amount && stake < minStake
      ? `Minimum stake is ${usd(minStake)}.`
      : stake > pool.usdcBalance
        ? `You have ${usd(pool.usdcBalance)} USDC. Use "Get test funds" at the top to get more.`
        : null;
  const canSubmit = agent && !agentError && strategy.trim() && stake >= minStake && !stakeError && !pool.busy;
  const coverageStarts = pool.now + waitingPeriodMs;

  return (
    <>
      <h1>Join the pool</h1>
      <p className="lede">
        Register your trading agent and commit to the strategy it must follow. If it breaks that strategy and loses
        money, you can file a claim.
      </p>

      <JoinProgress stake={stake} />

      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void pool.join(agent, strategy.trim(), stake);
        }}
      >
        <label>
          Agent address
          <input className="mono" placeholder="0x…" value={agent} onChange={(e) => setAgent(e.target.value.trim())} />
          <span className="hint">The wallet your agent trades from. One agent per member.</span>
        </label>
        {agentError && <p className="warn">{agentError}</p>}

        <label>
          Trading strategy
          <textarea
            rows={6}
            placeholder="e.g. Trade only ETH/USDC on Uniswap. Max 5% of portfolio per trade. Max 1% slippage."
            value={strategy}
            onChange={(e) => setStrategy(e.target.value)}
          />
          <span className="hint">
            Be specific: allowed tokens, venues, position sizes, slippage, leverage. Vague rules are hard to win claims
            on.
          </span>
        </label>
        {strategy.trim() && (
          <>
            <StrategyChips text={strategy} />
            <p className="muted mono small">Fingerprint stored on-chain: {strategyHash(strategy.trim())}</p>
          </>
        )}

        <label>
          Stake (USDC)
          <input type="number" min={minStake} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <span className="hint">Your stake also caps what a single claim can pay you.</span>
        </label>
        {stakeError && <p className="warn">{stakeError}</p>}

        <p className="muted">
          Coverage starts around {date(coverageStarts)} ({duration(waitingPeriodMs)} from now). To change your strategy
          later, you leave and rejoin, which restarts the wait. Joining takes two wallet confirmations: one to allow the
          pool to take your USDC, and one to join.
        </p>

        <button type="submit" className="button" disabled={!canSubmit}>
          Stake {stake ? usd(stake) : ''} and join
        </button>
      </form>
    </>
  );
}
