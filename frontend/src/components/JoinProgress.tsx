import { usePool } from '../state/PoolContext';
import { timeLeft } from '../lib/format';

type StepState = 'todo' | 'on' | 'ok';

/** Four steps to coverage: test funds → approve USDC → join → covered (with a countdown). */
export function JoinProgress({ stake }: { stake: number }) {
  const { tx, me, now, usdcBalance, params } = usePool();
  const live = (kind: string) => tx?.kind === kind && tx.stage !== 'confirmed';
  const needed = Math.max(stake, params.minStake);

  const funds: StepState = me || usdcBalance >= needed ? 'ok' : live('faucet') ? 'on' : 'todo';
  const approve: StepState =
    me || tx?.kind === 'join' || (tx?.kind === 'approve' && tx.stage === 'confirmed')
      ? 'ok'
      : live('approve')
        ? 'on'
        : 'todo';
  const join: StepState = me ? 'ok' : live('join') ? 'on' : 'todo';
  const covered: StepState = me && now >= me.coveredFrom ? 'ok' : me ? 'on' : 'todo';

  const steps = [
    { label: 'Test funds', state: funds },
    { label: 'Approve USDC', state: approve },
    { label: 'Join', state: join },
    { label: 'Covered', state: covered },
  ];

  let note = 'Two wallet confirmations: allow the pool to take your USDC, then join.';
  if (funds === 'todo') note = 'You need test USDC first: use "Get test funds" at the top.';
  else if (funds === 'on') note = 'Getting test funds from the CDP faucet…';
  else if (approve === 'on') note = 'Approve the USDC transfer in your wallet…';
  else if (join === 'on') note = 'Joining the pool…';
  else if (covered === 'on' && me) note = `Coverage starts in ${timeLeft(me.coveredFrom, now).replace(' left', '')}.`;
  else if (covered === 'ok') note = 'Your agent is covered.';

  return (
    <div className="card join-progress">
      <ol className="steps-track">
        {steps.map((s, i) => (
          <li key={s.label} className={`step step-${s.state}`}>
            <span className="step-dot" aria-hidden="true">
              {s.state === 'ok' ? '✓' : i + 1}
            </span>
            <span className="step-label">
              {s.label}
              <span className="sr-only">{s.state === 'ok' ? ' (done)' : s.state === 'on' ? ' (in progress)' : ''}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className={covered === 'ok' ? 'pos small join-note' : 'muted small join-note'} aria-live="polite">
        {note}
      </p>
    </div>
  );
}
