import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { isAddress } from 'viem';
import { usePool } from '../state/PoolContext';
import { RULES } from '../lib/rules';
import { date, strategyHash, usd } from '../lib/format';

export function Join() {
  const pool = usePool();
  const navigate = useNavigate();
  const [agent, setAgent] = useState('');
  const [strategy, setStrategy] = useState('');
  const [amount, setAmount] = useState('');

  if (pool.me) {
    return (
      <>
        <h1>You're already a member</h1>
        <p>
          See <Link to="/account">your account</Link>.
        </p>
      </>
    );
  }


  const stake = Number(amount || 0);
  const agentTaken = pool.members.some((m) => m.active && m.agent.toLowerCase() === agent.toLowerCase());
  const agentError = agent && !isAddress(agent) ? 'Not a valid address.' : agentTaken ? 'This agent is already registered.' : null;
  const stakeError = amount && stake < RULES.minStake ? `Minimum stake is ${usd(RULES.minStake)}.` : null;
  const canSubmit = agent && !agentError && strategy.trim() && stake >= RULES.minStake;
  const coverageStarts = pool.now + RULES.waitingPeriodMs;

  return (
    <>
      <h1>Join the pool</h1>
      <p className="lede">
        Register your trading agent and commit to the strategy it must follow. If it breaks that strategy and loses money,
        you can file a claim.
      </p>

      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          pool.join(agent, strategy.trim(), stake);
          navigate('/account');
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
            Be specific: allowed tokens, venues, position sizes, slippage, leverage. Vague rules are hard to win claims on.
          </span>
        </label>
        {strategy.trim() && (
          <p className="muted mono small">Fingerprint stored on-chain: {strategyHash(strategy.trim())}</p>
        )}

        <label>
          Stake (USDC)
          <input type="number" min={RULES.minStake} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <span className="hint">Your stake also caps what a single claim can pay you.</span>
        </label>
        {stakeError && <p className="warn">{stakeError}</p>}

        <p className="muted">
          Coverage starts {date(coverageStarts)}, after a {RULES.waitingPeriodMs / 86_400_000} day wait. To change your
          strategy later, you leave and rejoin, which restarts the wait.
        </p>

        <button type="submit" className="button" disabled={!canSubmit}>
          Stake {stake ? usd(stake) : ''} and join
        </button>
      </form>
    </>
  );
}
