import { useEffect, useId, useState } from 'react';
import type { PolarMessage, PolarPoint } from '../app/polarWorker';

const TWS_OPTIONS = [6, 10, 15];
/** Colour follows the wind speed (the entity), never its rank among the selected curves. */
const COLOR: Record<number, string> = { 6: 'var(--series-1)', 10: 'var(--series-2)', 15: 'var(--series-3)' };
const TWA = [35, 40, 45, 52, 60, 75, 90, 110, 135, 150, 165, 175];
const DURATION_S = 120;

/** Results survive closing the panel (the model is deterministic, so a sweep never needs repeating). */
const cache = new Map<number, PolarPoint[]>();

const W = 300;
const H = 336;
const CX = 40;
const CY = 168;
const R = 140;

export function PolarPanel({ onClose }: { onClose: () => void }) {
  const [selected, setSelected] = useState<number[]>([10]);
  const [version, setVersion] = useState(0);
  const [progress, setProgress] = useState<{ tws: number; done: number; total: number } | null>(null);
  const [table, setTable] = useState(false);
  const [hover, setHover] = useState<{ tws: number; p: PolarPoint } | null>(null);
  const titleId = useId();

  // Sweep each selected wind speed that is not cached yet, one at a time, in a worker.
  useEffect(() => {
    const todo = selected.find((t) => !cache.has(t));
    if (todo === undefined) {
      setProgress(null);
      return;
    }
    const worker = new Worker(new URL('../app/polarWorker.ts', import.meta.url), { type: 'module' });
    const points: PolarPoint[] = [];
    worker.onmessage = (ev: MessageEvent<PolarMessage>) => {
      const m = ev.data;
      if (m.type === 'point') {
        points.push(m.point);
        setProgress({ tws: m.twsKn, done: m.done, total: m.total });
      } else {
        cache.set(m.twsKn, points);
        worker.terminate();
        setVersion((n) => n + 1);
      }
    };
    setProgress({ tws: todo, done: 0, total: TWA.length });
    worker.postMessage({ twsKn: todo, twaDeg: TWA, durationS: DURATION_S });
    return () => worker.terminate();
  }, [selected, version]);

  const curves = TWS_OPTIONS.filter((t) => selected.includes(t) && cache.has(t)).map((t) => ({ tws: t, pts: cache.get(t)! }));
  const maxSpeed = Math.max(4, ...curves.flatMap((c) => c.pts.map((p) => p.stwKn)));
  const rings = Array.from({ length: Math.ceil(maxSpeed) }, (_, i) => i + 1);
  const scale = R / Math.ceil(maxSpeed);
  const xy = (twa: number, kn: number) => {
    const a = (twa * Math.PI) / 180;
    return [CX + kn * scale * Math.sin(a), CY - kn * scale * Math.cos(a)] as const;
  };
  const toggle = (t: number) => setSelected((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t].sort((a, b) => a - b)));
  const best = (pts: PolarPoint[], up: boolean) => pts.reduce((b, p) => ((up ? p.vmgKn > b.vmgKn : p.vmgKn < b.vmgKn) ? p : b), pts[0]!);

  return (
    <section className="panel polar" aria-label="Model polar">
      <div className="dash-head">
        <h3 id={titleId}>Model polar (speed through the water)</h3>
        <button onClick={onClose} aria-label="Close polar">Close</button>
      </div>
      <div className="dash-filters" role="group" aria-label="True wind speeds">
        {TWS_OPTIONS.map((t) => (
          <button key={t} aria-pressed={selected.includes(t)} onClick={() => toggle(t)}>{t} kn</button>
        ))}
        <span className="spacer" />
        <button aria-pressed={table} onClick={() => setTable(!table)}>Table</button>
      </div>
      <p className="fine">
        Model output from estimated coefficients, not measured Squib performance. Steady uniform wind, flat water,
        autopilot holding each angle and a max-drive sheet setting, {DURATION_S} s per point.
      </p>
      {progress && <p className="fine" role="status">Computing {progress.tws} kn: {progress.done} / {progress.total} angles…</p>}
      {curves.length > 1 && (
        <ul className="legend">
          {curves.map((c) => (
            <li key={c.tws}>
              <svg width="14" height="6" aria-hidden="true"><line x1="0" y1="3" x2="14" y2="3" stroke={COLOR[c.tws]} strokeWidth="2" strokeLinecap="round" /></svg>
              <span className="legend-name">TWS {c.tws} kn</span>
            </li>
          ))}
        </ul>
      )}
      {table ? (
        <table className="dash-table">
          <thead>
            <tr><th>TWA</th>{curves.map((c) => <th key={c.tws}>{c.tws} kn STW</th>)}{curves.map((c) => <th key={`h${c.tws}`}>{c.tws} kn heel</th>)}</tr>
          </thead>
          <tbody>
            {TWA.map((a) => (
              <tr key={a}>
                <td>{a}°</td>
                {curves.map((c) => <td key={c.tws}>{c.pts.find((p) => p.twaDeg === a)?.stwKn.toFixed(2) ?? '–'}</td>)}
                {curves.map((c) => <td key={`h${c.tws}`}>{c.pts.find((p) => p.twaDeg === a)?.heelDeg.toFixed(0) ?? '–'}°</td>)}
              </tr>
            ))}
            {curves.length > 0 && (
              <>
                <tr><td>Best VMG up</td>{curves.map((c) => { const b = best(c.pts, true); return <td key={c.tws}>{b.vmgKn.toFixed(2)} at {b.twaDeg}°</td>; })}{curves.map((c) => <td key={`h${c.tws}`} />)}</tr>
                <tr><td>Best VMG down</td>{curves.map((c) => { const b = best(c.pts, false); return <td key={c.tws}>{Math.abs(b.vmgKn).toFixed(2)} at {b.twaDeg}°</td>; })}{curves.map((c) => <td key={`h${c.tws}`} />)}</tr>
              </>
            )}
          </tbody>
        </table>
      ) : (
        <div className="chart-plot">
          <svg width={W} height={H} role="img" aria-labelledby={titleId}>
            {rings.map((k) => (
              <g key={k}>
                <path d={`M${CX},${CY - k * scale} A${k * scale},${k * scale} 0 0 1 ${CX},${CY + k * scale}`} className="grid" fill="none" />
                <text x={CX - 4} y={CY - k * scale} className="tick" textAnchor="end" dominantBaseline="central">{k}</text>
              </g>
            ))}
            {[0, 30, 60, 90, 120, 150, 180].map((a) => {
              const [x, y] = xy(a, Math.ceil(maxSpeed));
              const r = (a * Math.PI) / 180;
              return (
                <g key={a}>
                  <line x1={CX} y1={CY} x2={x} y2={y} className="grid" />
                  {a > 0 && a < 180 && (
                    <text x={x + 14 * Math.sin(r)} y={y - 14 * Math.cos(r)} className="tick" textAnchor="middle" dominantBaseline="central">{a}°</text>
                  )}
                </g>
              );
            })}
            <text x={CX - 4} y={CY + 4} className="tick" textAnchor="end" dominantBaseline="hanging">kn</text>
            <text x={CX + 6} y={CY - R - 12} className="tick" dominantBaseline="central">TWA 0° (wind from here)</text>
            <text x={CX + 6} y={CY + R + 12} className="tick" dominantBaseline="central">180°</text>
            {curves.map((c) => (
              <path key={c.tws} d={c.pts.map((p, i) => `${i ? 'L' : 'M'}${xy(p.twaDeg, p.stwKn).map((v) => v.toFixed(1)).join(',')}`).join('')} fill="none" stroke={COLOR[c.tws]} strokeWidth={2} strokeLinejoin="round" />
            ))}
            {curves.flatMap((c) =>
              c.pts.map((p) => {
                const [x, y] = xy(p.twaDeg, p.stwKn);
                const on = hover?.tws === c.tws && hover.p.twaDeg === p.twaDeg;
                return (
                  <g key={`${c.tws}-${p.twaDeg}`}>
                    <circle cx={x} cy={y} r={on ? 5.5 : 4} fill={COLOR[c.tws]} className="hover-dot" />
                    <circle cx={x} cy={y} r={10} fill="transparent" onPointerEnter={() => setHover({ tws: c.tws, p })} onPointerLeave={() => setHover(null)} />
                  </g>
                );
              }),
            )}
          </svg>
          {hover && (
            <div className="tooltip" style={{ left: Math.min(xy(hover.p.twaDeg, hover.p.stwKn)[0] + 10, W - 140), top: xy(hover.p.twaDeg, hover.p.stwKn)[1] }} role="status">
              <div><strong>{hover.p.stwKn.toFixed(2)} kn</strong> STW</div>
              <div className="tooltip-t">TWA {hover.p.twaDeg}° · TWS {hover.tws} kn</div>
              <div className="tooltip-t">heel {hover.p.heelDeg.toFixed(0)}° · VMG {hover.p.vmgKn.toFixed(2)} kn</div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
