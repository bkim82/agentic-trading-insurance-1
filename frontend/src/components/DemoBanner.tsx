import { useNavigate } from 'react-router-dom';
import { usePool } from '../state/PoolContext';
import { useDemoMode } from '../state/DemoMode';
import { DEMO_BAD_BUY, DEMO_BAD_SELL, useDemoControls } from '../state/DemoPool';

/** Dark bar shown in demo mode, with a five-step guided tour that follows what you've done. */
export function DemoBanner() {
  const controls = useDemoControls();
  const { exit } = useDemoMode();
  const pool = usePool();
  const navigate = useNavigate();
  if (!controls) return null;

  const mine = pool.claims.find((c) => c.claimant === pool.you);
  const cast = mine ? mine.approve + mine.reject + mine.fraud : 0;
  const fileUrl = `/claims/new?buy=${DEMO_BAD_BUY}&sell=${DEMO_BAD_SELL}`;
  const steps = [
    {
      title: '1. Join',
      note: 'Get test funds, stake, commit a strategy',
      done: !!pool.me,
      go: () => navigate('/join'),
    },
    {
      title: '2. Bot slips up',
      note:
        pool.me && pool.now < pool.me.coveredFrom
          ? `Coverage starts in ${Math.ceil((pool.me.coveredFrom - pool.now) / 1000)}s`
          : 'Simulate a bad trade',
      done: controls.badTrade,
      go: () => {
        controls.simulateBadTrade();
        navigate(fileUrl);
      },
    },
    { title: '3. File claim', note: 'Buy + sell read for you', done: !!mine, go: () => navigate(fileUrl) },
    {
      title: '4. Members vote',
      note: 'Bots vote within seconds',
      done: !!mine && (mine.status !== 'open' || pool.now >= mine.votingEnds),
      go: () => mine && navigate(`/claims/${mine.id}`),
      live: !!mine && mine.status === 'open' && cast > 0,
    },
    {
      title: '5. Get paid',
      note: 'Resolve once voting ends',
      done: mine?.status === 'approved',
      go: () => mine && navigate(`/claims/${mine.id}`),
    },
  ];
  const current = steps.findIndex((s) => !s.done);

  return (
    <section className="demo-bar" aria-label="Demo mode">
      <div className="demo-bar-head">
        <span className="demo-dot" aria-hidden="true" />
        <span>
          <strong>Demo mode</strong> · pretend wallet and transactions. Nothing touches the chain; time runs fast.
        </span>
        <button type="button" className="demo-exit" onClick={exit}>
          Exit demo
        </button>
      </div>
      <ol className="demo-tour">
        {steps.map((s, i) => (
          <li key={s.title}>
            <button
              type="button"
              className={s.done ? 'done' : i === current ? 'on' : undefined}
              aria-current={i === current ? 'step' : undefined}
              onClick={s.go}
            >
              {s.done ? '✓ ' : ''}
              {s.title}
              <small>{s.note}</small>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
