import { NavLink, Outlet } from 'react-router-dom';
import { usePool } from '../state/PoolContext';
import { DAY } from '../lib/rules';
import { shortAddr } from '../lib/format';

export function Layout() {
  const { you, me, skipAhead, timeOffsetMs } = usePool();

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
        <span className="wallet" title="Wallet connection is mocked">
          {shortAddr(you)}
        </span>
      </header>

      <main>
        <Outlet />
      </main>

      <footer className="site-footer">
        <span>Demo data only. Not connected to the contract.</span>
        <span className="demo-controls">
          {timeOffsetMs > 0 && <span>Time skipped: {Math.round(timeOffsetMs / DAY)} days</span>}
          <button type="button" className="link-button" onClick={() => skipAhead(3 * DAY)}>
            Skip ahead 3 days
          </button>
        </span>
      </footer>
    </div>
  );
}
