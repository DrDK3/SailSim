import { useEffect, useMemo, useRef, useState } from 'react';
import type { SimController, UiState } from '../app/controller';
import { SPEED_RAMP, speedColour, type Manoeuvre, type TrackPoint } from '../app/sailLog';
import { mmss } from '../app/lessons';

const KN = 0.514444;
const W = 560;
const H = 360;

/**
 * The debrief after every sail (src/app/sailLog.ts): the track on the chart, coloured by speed over the ground (one
 * hue, muted to bright), the tacks (T) and gybes (G), the start line in a race; then the numbers, each tack and gybe
 * with what it cost, and the coach's notes in a race. Hover the track for the time and speed there.
 */
export function DebriefPanel({ ctl, ui, onClose }: { ctl: SimController; ui: UiState; onClose: () => void }) {
  // Recomputed when the panel opens and every few seconds while it is open (the track grows once a second).
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((x) => x + 1), 3000);
    return () => window.clearInterval(id);
  }, []);
  const d = useMemo(() => ctl.sailDebrief(), [ctl, tick, ui.snapshot.t > 0]);
  const s = d.summary;
  const [hover, setHover] = useState<{ x: number; y: number; p: TrackPoint } | undefined>();
  const [table, setTable] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const data = ctl.dartData;
  useEffect(() => {
    if (!data?.minimapUrl) return;
    const im = new Image();
    im.onload = () => setImg(im);
    im.src = data.minimapUrl;
  }, [data?.minimapUrl]);

  // The chart fitted to the track (and the line), north up, with a margin; at least 200 m across.
  const view = useMemo(() => {
    const pts = [...d.points.map((p) => ({ n: p.n, e: p.e })), ...(d.line ?? [])];
    if (!pts.length) return undefined;
    let nMin = Math.min(...pts.map((p) => p.n));
    let nMax = Math.max(...pts.map((p) => p.n));
    let eMin = Math.min(...pts.map((p) => p.e));
    let eMax = Math.max(...pts.map((p) => p.e));
    const span = Math.max(200, (nMax - nMin) * 1.15, ((eMax - eMin) * 1.15 * H) / W);
    const cn = (nMin + nMax) / 2;
    const ce = (eMin + eMax) / 2;
    nMin = cn - span / 2;
    nMax = cn + span / 2;
    const eSpan = (span * W) / H;
    eMin = ce - eSpan / 2;
    eMax = ce + eSpan / 2;
    const k = H / span;
    return { k, toPx: (n: number, e: number) => [(e - eMin) * k, (nMax - n) * k] as const, nMin, nMax, eMin, eMax };
  }, [d.points.length, d.line]);
  const maxSog = Math.max(0.1, ...d.points.map((p) => p.sog));

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    if (c.width !== Math.round(W * dpr)) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#1f4b6b';
    ctx.fillRect(0, 0, W, H);
    if (!view) return;
    const m = data?.manifest;
    if (img && m) {
      const [x0, y0] = view.toPx(m.domain.nMax, m.domain.eMin);
      const [x1, y1] = view.toPx(m.domain.nMin, m.domain.eMax);
      ctx.drawImage(img, x0, y0, x1 - x0, y1 - y0);
    }
    if (d.line) {
      const [a, b] = d.line;
      const [ax, ay] = view.toPx(a.n, a.e);
      const [bx, by] = view.toPx(b.n, b.e);
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // The track: a dark outline, then each second's segment in its speed colour.
    const pts = d.points.map((p) => view.toPx(p.n, p.e));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(8, 16, 24, 0.85)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    ctx.lineWidth = 2.5;
    for (let i = 1; i < pts.length; i++) {
      ctx.strokeStyle = speedColour(d.points[i]!.sog / maxSog);
      ctx.beginPath();
      ctx.moveTo(pts[i - 1]![0], pts[i - 1]![1]);
      ctx.lineTo(pts[i]![0], pts[i]![1]);
      ctx.stroke();
    }
    // Start and end of the track.
    if (pts.length) {
      const [sx, sy] = pts[0]!;
      const [ex, ey] = pts[pts.length - 1]!;
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#08101a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillRect(ex - 4, ey - 4, 8, 8);
      ctx.strokeRect(ex - 4, ey - 4, 8, 8);
    }
    // Tacks and gybes.
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const mv of s.manoeuvres) {
      const [x, y] = view.toPx(mv.n, mv.e);
      ctx.fillStyle = '#08101a';
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(mv.kind === 'tack' ? 'T' : 'G', x, y + 0.5);
    }
    if (hover) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(hover.x, hover.y, 7, 0, Math.PI * 2);
      ctx.stroke();
    }
  }, [view, img, d, hover, maxSog, s.manoeuvres, data?.manifest]);

  const onMove = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    if (!view || !d.points.length) return;
    const r = ev.currentTarget.getBoundingClientRect();
    const x = ((ev.clientX - r.left) / r.width) * W;
    const y = ((ev.clientY - r.top) / r.height) * H;
    let best: { x: number; y: number; p: TrackPoint; d2: number } | undefined;
    for (const p of d.points) {
      const [px, py] = view.toPx(p.n, p.e);
      const d2 = (px - x) ** 2 + (py - y) ** 2;
      if (!best || d2 < best.d2) best = { x: px, y: py, p, d2 };
    }
    setHover(best && best.d2 < 18 * 18 ? best : undefined);
  };

  const sec = (x?: number) => (x === undefined ? '—' : `${x >= 0 ? '' : 'gained '}${Math.abs(x).toFixed(1)} s`);
  const kn = (x?: number) => (x === undefined ? '—' : `${x.toFixed(1)} kn`);
  const rows: [string, string][] = [
    ['Time sailed', mmss(s.durationS)],
    ['Distance sailed', s.distanceM >= 1000 ? `${(s.distanceM / 1852).toFixed(2)} nm` : `${Math.round(s.distanceM)} m`],
    ['Average speed over the ground', kn(s.meanSogKn)],
    ['Top speed', kn(s.maxSogKn)],
    ['Best 30 s to windward (VMG)', kn(s.bestUpwindVmgKn)],
    ['Tacks', s.tacks.count ? `${s.tacks.count} · each cost ${sec(s.tacks.meanLossS)} on average, the worst ${sec(s.tacks.worstLossS)}` : 'none'],
    ['Gybes', s.gybes.count ? `${s.gybes.count} · each cost ${sec(s.gybes.meanLossS)} on average, the worst ${sec(s.gybes.worstLossS)}` : 'none'],
  ];
  if (s.start) {
    rows.push(['Start', s.start.ocs ? 'over the line at the gun' : s.start.lateS === undefined ? 'not started' : `crossed ${s.start.lateS.toFixed(1)} s after the gun`]);
    rows.push(['At the gun', s.start.distToLineAtGunM === undefined ? '—' : `${Math.round(s.start.distToLineAtGunM)} m from the line, ${kn(s.start.sogAtGunKn)}`]);
  }
  return (
    <section className="panel dashboard debrief-panel" aria-label="Your sail" data-testid="debrief">
      <div className="dash-head">
        <h3>Your sail</h3>
        <button aria-pressed={table} onClick={() => setTable(!table)}>
          {table ? 'Chart' : 'Each tack and gybe'}
        </button>
        <button onClick={onClose} aria-label="Close the debrief">Close</button>
      </div>
      {!d.points.length ? (
        <p className="fine">Sail for a few seconds and your track appears here.</p>
      ) : table ? (
        <ManoeuvreTable manoeuvres={s.manoeuvres} t0={d.points[0]!.t} />
      ) : (
        <>
          <div className="debrief-chart">
            <canvas ref={canvas} style={{ width: '100%', aspectRatio: `${W} / ${H}` }} onMouseMove={onMove} onMouseLeave={() => setHover(undefined)} aria-label={`Your track: ${s.tacks.count} tacks, ${s.gybes.count} gybes`} role="img" />
            {hover && (
              <div className="debrief-tip" style={{ left: `${(hover.x / W) * 100}%`, top: `${(hover.y / H) * 100}%` }}>
                {mmss(hover.p.t - d.points[0]!.t)} · {(hover.p.sog / KN).toFixed(1)} kn · TWA {Math.round(hover.p.twaDeg)}°
              </div>
            )}
          </div>
          <div className="debrief-legend" aria-hidden="true">
            <span>Speed over the ground</span>
            <span className="ramp" style={{ background: `linear-gradient(to right, ${SPEED_RAMP.join(', ')})` }} />
            <span>0–{(maxSog / KN).toFixed(1)} kn</span>
            <span className="key">T tack · G gybe · ● start · ■ now{d.line ? ' · - - start line' : ''}</span>
          </div>
        </>
      )}
      <table className="dash-table debrief-stats">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <th scope="row">{k}</th>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {d.coach && d.coach.items.length > 0 && (
        <>
          <h4>The coach</h4>
          <ul className="coach-list debrief">
            {d.coach.items.map((it, i) => (
              <li key={i} className={`v-${it.verdict}`}>
                <strong>{it.area}:</strong> {it.text}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="fine">
        A tack or gybe's cost is the ground lost towards (or away from) the wind from 5 s before it to 15 s after, against the speed made good in the 15 s
        before, as time at that speed. The windows are the simulator's choice (E).
      </p>
    </section>
  );
}

function ManoeuvreTable({ manoeuvres, t0 }: { manoeuvres: readonly Manoeuvre[]; t0: number }) {
  if (!manoeuvres.length) return <p className="fine">No tacks or gybes yet.</p>;
  return (
    <table className="dash-table" data-testid="debrief-manoeuvres">
      <thead>
        <tr>
          <th>When</th>
          <th>What</th>
          <th>Cost</th>
        </tr>
      </thead>
      <tbody>
        {manoeuvres.map((m, i) => (
          <tr key={i}>
            <td>{mmss(m.t - t0)}</td>
            <td>{m.kind === 'tack' ? 'Tack' : 'Gybe'}</td>
            <td>{m.lossS === undefined ? 'not costed (too slow, or too near the end)' : m.lossS >= 0 ? `${m.lossS.toFixed(1)} s (${Math.round(m.lossM!)} m)` : `gained ${(-m.lossS).toFixed(1)} s`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
