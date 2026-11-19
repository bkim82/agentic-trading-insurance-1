import { NavLink, Outlet } from 'react-router-dom';
import { usePool } from '../state/PoolContext';
import { EXPLORER, POOL_ADDRESS } from '../lib/chain';
import { shortAddr, usd } from '../lib/format';

export function Layout() {
  const pool = usePool();
  const { you, me, isConnected, wrongNetwork, busy, error, lastTx } = pool;

  return (
    <div className="page">
      <header className="site-header">
        <NavLink to="/" className="brand">
          Agent Insurance Pool
        </NavLink>
        <nav className="nav">
          <NavLink to="/" end>
            Pool
          </NavLink>
          <NavLink to="/claims">Claims</NavLink>
          {me ? <NavLink to="/account">My account</NavLink> : <NavLink to="/join">Join</NavLink>}
        </nav>
        {isConnected ? (
          <span className="wallet-area">
            <span className="muted small">
              {usd(pool.usdcBalance)} USDC · {pool.ethBalance.toFixed(4)} ETH
            </span>
            <button type="button" className="link-button small" onClick={() => void pool.requestTestFunds()} disabled={!!busy}>
              Get test funds
            </button>
            <span className="wallet" title={you}>
              {shortAddr(you)}
            </span>
            <button type="button" className="link-button small" onClick={pool.disconnect}>
              Disconnect
            </button>
          </span>
        ) : (
          <button type="button" className="button" onClick={() => void pool.connect()}>
            Connect wallet
          </button>
        )}
      </header>

      {wrongNetwork && (
        <p className="banner banner-warn">
          Your wallet is on a different network. This pool runs on Base Sepolia.{' '}
          <button type="button" className="link-button" onClick={() => void pool.switchNetwork()}>
            Switch to Base Sepolia
          </button>
        </p>
      )}
      {busy && (
        <p className="banner" role="status">
          {busy}
          {lastTx && (
            <>
              {' '}
              <a href={`${EXPLORER}/tx/${lastTx}`} target="_blank" rel="noreferrer">
                View transaction
              </a>
            </>
          )}
        </p>
      )}
      {error && (
        <p className="banner banner-error" role="alert">
          {error}{' '}
          <button type="button" className="link-button" onClick={pool.dismissError}>
            Dismiss
          </button>
        </p>
      )}

      <main>
        {pool.loading ? <p className="muted">Loading the pool from Base Sepolia…</p> : <Outlet />}
      </main>

      <footer className="site-footer">
        <span>
          Base Sepolia testnet · Contract{' '}
          <a href={`${EXPLORER}/address/${POOL_ADDRESS}`} target="_blank" rel="noreferrer">
            {shortAddr(POOL_ADDRESS)}
          </a>
        </span>
        <span>Test funds come from the CDP faucet.</span>
      </footer>
    </div>
  );
}
