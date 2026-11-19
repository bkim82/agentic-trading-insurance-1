import { useEffect, useRef, useState } from 'react';
import { pct, usd } from '../lib/format';

/** Tank height in px; layer heights are computed in px from it. */
const TANK_PX = 150;
/** Water stays visible for a tiny pool, and your layer for a tiny stake. */
const MIN_WATER_PX = 8;
const MIN_LAYER_PX = 4;
/** Below this your layer is too thin to hold its label, so the label sits just above it. */
const LABEL_INSIDE_PX = 18;

/** Share as a percent, without rounding a real stake down to "0%". */
function share(part: number, whole: number): string {
  const r = whole > 0 ? part / whole : 0;
  if (r > 0 && r < 0.01) return '<1%';
  if (r < 1 && r > 0.99) return '>99%';
  return pct(r);
}

/** Scale to the next $5 above the pool (with headroom) so the tank never looks empty or full. */
function tankCapacity(total: number): number {
  return Math.max(5, Math.ceil((total * 1.25) / 5) * 5);
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Animates a number from its previous value to `target` (instant with reduced motion). */
function useCountUp(target: number): number {
  const [value, setValue] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    const from = fromRef.current;
    const duration = prefersReducedMotion() ? 0 : 900;
    const start = performance.now();
    let frame = 0;
    const step = (t: number) => {
      const k = duration ? Math.min(1, (t - start) / duration) : 1;
      const v = from + (target - from) * (1 - (1 - k) ** 3);
      fromRef.current = v;
      setValue(v);
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return value;
}

function Wave({ color, back }: { color: string; back?: boolean }) {
  return (
    <svg
      className={back ? 'tank-wave back' : 'tank-wave'}
      viewBox="0 0 240 12"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d="M0 6 Q15 0 30 6 T60 6 T90 6 T120 6 T150 6 T180 6 T210 6 T240 6 V12 H0Z" fill={color} />
    </svg>
  );
}

const YOU = '#0052ff';
const OTHERS = '#8fb0ff';

/**
 * Liquid tank for the pool. Your stake is the base layer; everyone else fills above it.
 * When the pool changes, a drop falls in and the change floats up from the surface.
 */
export function PoolTank({ total, mine }: { total: number; mine: number }) {
  const yours = Math.min(Math.max(mine, 0), total);
  const others = Math.max(total - yours, 0);
  const capacity = tankCapacity(total);
  // Heights are true to scale; only the minimums keep tiny amounts visible.
  const waterPx = total > 0 ? Math.max(MIN_WATER_PX, (total / capacity) * TANK_PX) : 0;
  const yoursPx = yours > 0 ? Math.min(waterPx, Math.max(MIN_LAYER_PX, (yours / total) * waterPx)) : 0;
  const othersPx = others > 0 ? waterPx - yoursPx : 0;
  const labelInside = yoursPx >= LABEL_INSIDE_PX;

  // Track changes during render (no effect needed) so each change re-keys the splash.
  const [prev, setPrev] = useState(total);
  const [change, setChange] = useState<{ delta: number; n: number } | null>(null);
  if (total !== prev) {
    setPrev(total);
    if (prev > 0) setChange({ delta: total - prev, n: (change?.n ?? 0) + 1 });
  }

  const shown = useCountUp(total);
  const settled = Math.abs(shown - total) < 1e-9;
  const surfaceColor = others > 0 ? OTHERS : YOU;

  return (
    <div className="pool-tank">
      <div
        className="tank"
        role="img"
        aria-label={yours > 0 ? `Pool ${usd(total)}, your stake ${usd(yours)}` : `Pool ${usd(total)}`}
      >
        <div className="tank-water">
          {yours > 0 && (
            <div className="tank-layer you" style={{ height: yoursPx, background: YOU }}>
              {others === 0 && (
                <>
                  <Wave color={YOU} back />
                  <Wave color={YOU} />
                </>
              )}
              {labelInside && <b>You</b>}
            </div>
          )}
          {others > 0 && (
            <div className="tank-layer" style={{ height: othersPx, background: OTHERS }}>
              <Wave color={surfaceColor} back />
              <Wave color={surfaceColor} />
              <span className="tank-bubble" style={{ left: '30%' }} />
              <span className="tank-bubble" style={{ left: '62%', animationDelay: '1.2s' }} />
            </div>
          )}
        </div>
        {yours > 0 && !labelInside && (
          // With no one above you, the wave sits on your layer, so clear it.
          <span className="tank-you-tag" style={{ bottom: yoursPx + (others > 0 ? 3 : 14) }}>
            You ▾
          </span>
        )}
        {change && (
          <span key={change.n}>
            <span className="tank-drop" style={{ background: change.delta > 0 ? surfaceColor : 'transparent' }} />
            <span
              className={change.delta > 0 ? 'tank-splash pos' : 'tank-splash neg'}
              style={{ top: Math.max(4, TANK_PX - waterPx - 22) }}
            >
              {change.delta > 0 ? '+' : '−'}
              {usd(Math.abs(change.delta))}
            </span>
          </span>
        )}
      </div>

      <div className="tank-info">
        <p className="label">Pool</p>
        <p className="big-number">{settled ? usd(total) : `$${shown.toFixed(2)}`}</p>
        {yours > 0 && total > 0 && (
          <ul className="tank-key">
            {others > 0 && (
              <li>
                <i style={{ background: OTHERS }} />
                Other members
                <span>{share(others, total)}</span>
              </li>
            )}
            <li>
              <i style={{ background: YOU }} />
              <b>You</b>
              <span>
                {usd(yours)} · {share(yours, total)}
              </span>
            </li>
          </ul>
        )}
      </div>
    </div>
  );
}
