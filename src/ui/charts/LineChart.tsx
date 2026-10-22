import { useId, useMemo, useState } from 'react';

export interface Series {
  name: string;
  values: number[];
  /** CSS colour token, e.g. 'var(--series-1)'. */
  color: string;
}

export interface LineChartProps {
  title: string;
  unit: string;
  t: number[];
  series: Series[];
  tNow: number;
  windowS: number;
  decimals?: number;
  /** Force these values into the y-range (e.g. 0 for forces). */
  include?: number[];
}

const W = 252;
const H = 118;
const M = { l: 34, r: 8, t: 6, b: 18 };

function niceTicks(lo: number, hi: number, count = 4): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0];
  if (hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  }
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

/**
 * Small time-series chart (SVG): 2px lines, hairline gridlines, one y-axis, legend with the latest values,
 * crosshair + tooltip listing every series at the hovered time (pointer or keyboard).
 */
export function LineChart({ title, unit, t, series, tNow, windowS, decimals = 1, include = [] }: LineChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const titleId = useId();
  const tMin = tNow - windowS;
  const { yLo, yHi, ticks } = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of series) for (const v of s.values) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    for (const v of include) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const ticks = niceTicks(lo, hi);
    return { yLo: Math.min(lo, ticks[0]!), yHi: Math.max(hi, ticks[ticks.length - 1]!), ticks };
  }, [series, include]);
  const x = (tt: number) => M.l + ((tt - tMin) / windowS) * (W - M.l - M.r);
  const y = (v: number) => M.t + (1 - (v - yLo) / (yHi - yLo || 1)) * (H - M.t - M.b);
  const path = (vals: number[]) => {
    let d = '';
    vals.forEach((v, i) => {
      if (!Number.isFinite(v)) return;
      d += `${d ? 'L' : 'M'}${x(t[i]!).toFixed(1)},${y(v).toFixed(1)}`;
    });
    return d;
  };
  const last = t.length - 1;
  const fmt = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? '–' : v.toFixed(decimals));

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const tt = tMin + ((e.clientX - r.left) / r.width) * windowS;
    let best = 0;
    for (let i = 0; i < t.length; i++) if (Math.abs(t[i]! - tt) < Math.abs(t[best]! - tt)) best = i;
    setHover(t.length ? best : null);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (!t.length) return;
    if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? last) - 1));
    else if (e.key === 'ArrowRight') setHover((h) => Math.min(last, (h ?? last) + 1));
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  const hi = hover !== null && hover <= last ? hover : null;

  return (
    <figure className="chart" aria-labelledby={titleId}>
      <figcaption id={titleId}>
        <span className="chart-title">{title}</span> <span className="chart-unit">{unit}</span>
      </figcaption>
      {series.length > 1 ? (
        <ul className="legend">
          {series.map((s) => (
            <li key={s.name}>
              <svg width="14" height="6" aria-hidden="true"><line x1="0" y1="3" x2="14" y2="3" stroke={s.color} strokeWidth="2" strokeLinecap="round" /></svg>
              <span className="legend-name">{s.name}</span> <span className="legend-value">{fmt(s.values[last])}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="legend single"><span className="legend-value">{fmt(series[0]?.values[last])}</span> {unit}</div>
      )}
      <div className="chart-plot">
        <svg width={W} height={H} role="img" aria-label={`${title}, last ${windowS} seconds`} tabIndex={0} onKeyDown={onKey} onBlur={() => setHover(null)}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} className="grid" />
              <text x={M.l - 4} y={y(v)} className="tick" textAnchor="end" dominantBaseline="central">{v}</text>
            </g>
          ))}
          {[0, 0.5, 1].map((f) => (
            <text key={f} x={M.l + f * (W - M.l - M.r)} y={H - 4} className="tick" textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}>
              {f === 1 ? 'now' : `−${Math.round(windowS * (1 - f))} s`}
            </text>
          ))}
          {series.map((s) => (
            <path key={s.name} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {hi !== null && (
            <g>
              <line x1={x(t[hi]!)} x2={x(t[hi]!)} y1={M.t} y2={H - M.b} className="crosshair" />
              {series.map((s) =>
                Number.isFinite(s.values[hi]!) ? <circle key={s.name} cx={x(t[hi]!)} cy={y(s.values[hi]!)} r={4} fill={s.color} className="hover-dot" /> : null,
              )}
            </g>
          )}
          <rect x={M.l} y={M.t} width={W - M.l - M.r} height={H - M.t - M.b} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
        </svg>
        {hi !== null && (
          <div className="tooltip" style={{ left: Math.min(x(t[hi]!) + 8, W - 120) }} role="status">
            <div className="tooltip-t">t = {t[hi]!.toFixed(1)} s</div>
            {series.map((s) => (
              <div key={s.name} className="tooltip-row">
                <svg width="12" height="6" aria-hidden="true"><line x1="0" y1="3" x2="12" y2="3" stroke={s.color} strokeWidth="2" /></svg>
                <strong>{fmt(s.values[hi])}</strong> <span>{s.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </figure>
  );
}
