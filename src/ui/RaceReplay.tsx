import { useEffect, useMemo, useRef, useState } from 'react';
import type { SimController } from '../app/controller';
import { coursePoints } from '../app/courseFit';
import { drawCourse, drawCourseNames } from './courseMap';

const W = 560;
const H = 360;
/** How many times faster than the race the replay plays. */
const SPEEDS = [8, 16, 32] as const;

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
/** A hull colour made light enough to read as a line on the water (dark hulls are mixed towards white). */
function onWater(c: number): string {
  const r = (c >> 16) & 255;
  const g = (c >> 8) & 255;
  const b = c & 255;
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const k = lum < 0.45 ? 0.45 : 0.1;
  const mix = (v: number) => Math.round(v + (255 - v) * k);
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

/** Time against the start signal: "0:42 to the start", "3:15 after the start". */
function raceClock(t: number, startT: number): string {
  const d = Math.round(t - startT);
  const a = Math.abs(d);
  const text = `${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
  return d < 0 ? `${text} to the start` : `${text} after the start`;
}

/**
 * The race from above (owner, 18 Nov 2026: "the whole fleet's tracks on the map; a replay of the race from above"):
 * every boat's track over the course, north up, and the fleet where it was at the chosen moment. Play it, or drag the
 * time. It is the record of the race as it was sailed (positions kept once a second: src/app/fleetTrack.ts), not a
 * second simulation. `tick` changes when the record may have grown (the race is still on).
 */
export function RaceReplay({ ctl, img, tick }: { ctl: SimController; img: HTMLImageElement | null; tick: number }) {
  const race = ctl.race;
  const track = ctl.fleetTrack;
  const canvas = useRef<HTMLCanvasElement>(null);
  const span = track.span;
  const samples = track.length;
  const startT = race?.session.committee.startTime ?? span?.from ?? 0;
  // The chosen moment (simulation seconds); undefined = the end of the record (it follows a race still being sailed).
  const [chosen, setChosen] = useState<number>();
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(16);
  const [hover, setHover] = useState<{ x: number; y: number; label: string }>();
  /** Where playing starts from (the chosen moment when Play was pressed, or where the speed was changed). */
  const playFrom = useRef<number | undefined>(undefined);
  const at = Math.min(span?.to ?? 0, Math.max(span?.from ?? 0, chosen ?? span?.to ?? 0));

  // The map fitted to the course and to everywhere the fleet went, with a margin.
  const view = useMemo(() => {
    const pts = race ? coursePoints(race.resolved) : [];
    let nMin = Infinity;
    let nMax = -Infinity;
    let eMin = Infinity;
    let eMax = -Infinity;
    const take = (n: number, e: number) => {
      nMin = Math.min(nMin, n);
      nMax = Math.max(nMax, n);
      eMin = Math.min(eMin, e);
      eMax = Math.max(eMax, e);
    };
    for (const p of pts) take(p.n, p.e);
    track.boats.forEach((_, i) => {
      const tr = track.track(i);
      for (let j = 0; j < tr.n.length; j++) take(tr.n[j]!, tr.e[j]!);
    });
    if (!Number.isFinite(nMin)) return undefined;
    const spanN = Math.max(200, (nMax - nMin) * 1.16, ((eMax - eMin) * 1.16 * H) / W);
    const cn = (nMin + nMax) / 2;
    const ce = (eMin + eMax) / 2;
    const k = H / spanN;
    const e0 = ce - (spanN * W) / H / 2;
    const n1 = cn + spanN / 2;
    return { k, toPx: (n: number, e: number) => [(e - e0) * k, (n1 - n) * k] as const };
    // The record's length stands for its contents (it only grows, or is cleared).
  }, [race, track, samples, tick]);

  // Playing: the chosen moment runs on at the chosen speed, and stops at the end of the record.
  useEffect(() => {
    if (!playing || !span) return;
    let raf = 0;
    let last = performance.now();
    let moment = playFrom.current ?? span.from;
    const frame = (now: number) => {
      // The time that really passed (up to a second: a tab left in the background does not jump to the end), so a
      // slow device plays at the stated speed, in bigger steps.
      const dt = Math.min(1, (now - last) / 1000);
      last = now;
      moment += dt * speed;
      if (moment >= span.to) {
        setChosen(undefined);
        setPlaying(false);
        return;
      }
      playFrom.current = moment;
      setChosen(moment);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, span?.from, span?.to]);

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
    const m = ctl.dartData?.manifest;
    if (img && m) {
      const [x0, y0] = view.toPx(m.domain.nMax, m.domain.eMin);
      const [x1, y1] = view.toPx(m.domain.nMin, m.domain.eMax);
      ctx.drawImage(img, x0, y0, x1 - x0, y1 - y0);
    }
    // Shown narrower than it is drawn (a phone's panel): the words and marks larger, to stay the same on the screen.
    const ui = Math.max(1, Math.min(2.2, W / (c.clientWidth || W)));
    if (race) drawCourse(ctx, race.resolved, view.toPx, { scale: ui });
    // The tracks: each boat's whole track faint, and bright up to the chosen moment. Yours last, white on dark.
    const upTo = track.indexAt(at);
    const order = track.boats.map((b, i) => ({ b, i })).sort((x, y) => Number(x.b.you) - Number(y.b.you));
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const path = (i: number, from: number, to: number) => {
      const tr = track.track(i);
      ctx.beginPath();
      for (let j = from; j <= to && j < tr.n.length; j++) {
        const [x, y] = view.toPx(tr.n[j]!, tr.e[j]!);
        if (j === from) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    };
    for (const { b, i } of order) {
      const colour = b.you ? '#ffffff' : onWater(b.colour);
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = colour;
      ctx.lineWidth = ui;
      path(i, upTo, samples - 1);
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (b.you) {
        ctx.strokeStyle = 'rgba(8,16,24,0.85)';
        ctx.lineWidth = 4.5 * ui;
        path(i, 0, upTo);
        ctx.stroke();
      }
      ctx.strokeStyle = colour;
      ctx.lineWidth = (b.you ? 2.4 : 1.5) * ui;
      path(i, 0, upTo);
      ctx.stroke();
    }
    // The marks' names over the tracks, then the fleet at the chosen moment.
    if (race) drawCourseNames(ctx, race.resolved, view.toPx, ui);
    const poses = track.at(at);
    ctx.font = `700 ${11 * ui}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const { b, i } of order) {
      const p = poses[i];
      if (!p) continue;
      const [x, y] = view.toPx(p.n, p.e);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(p.heading);
      ctx.fillStyle = b.you ? '#ffffff' : hex(b.colour);
      ctx.strokeStyle = b.you ? '#08101a' : 'rgba(255,255,255,0.85)';
      ctx.lineWidth = (b.you ? 1.6 : 1) * ui;
      const s = (b.you ? 1.3 : 1) * ui;
      ctx.beginPath();
      ctx.moveTo(0, -7 * s);
      ctx.lineTo(4.2 * s, 5 * s);
      ctx.lineTo(0, 2.6 * s);
      ctx.lineTo(-4.2 * s, 5 * s);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      if (b.you) {
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(8,20,28,0.85)';
        ctx.lineWidth = 3 * ui;
        ctx.strokeText('You', x, y - 14 * ui);
        ctx.fillStyle = '#ffffff';
        ctx.fillText('You', x, y - 14 * ui);
      }
    }
    if (hover) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2 * ui;
      ctx.beginPath();
      ctx.arc(hover.x, hover.y, 10 * ui, 0, Math.PI * 2);
      ctx.stroke();
    }
  }, [view, img, at, samples, hover, race, track, ctl, tick]);

  const onMove = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    if (!view) return;
    const r = ev.currentTarget.getBoundingClientRect();
    const x = ((ev.clientX - r.left) / r.width) * W;
    const y = ((ev.clientY - r.top) / r.height) * H;
    let best: { x: number; y: number; label: string; d2: number } | undefined;
    track.at(at).forEach((p, i) => {
      const [px, py] = view.toPx(p.n, p.e);
      const d2 = (px - x) ** 2 + (py - y) ** 2;
      if (!best || d2 < best.d2) best = { x: px, y: py, label: track.boats[i]!.label, d2 };
    });
    setHover(best && best.d2 < 16 * 16 ? best : undefined);
  };

  if (!span || samples < 2) return <p className="fine" data-testid="race-replay-empty">The fleet’s tracks appear here once the race is under way.</p>;
  const atEnd = chosen === undefined;
  return (
    <div className="race-replay" data-testid="race-replay">
      <div className="debrief-chart">
        <canvas
          ref={canvas}
          style={{ width: '100%', aspectRatio: `${W} / ${H}` }}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(undefined)}
          role="img"
          aria-label={`The race from above, north up: the tracks of all ${track.boats.length} boats over the course, at ${raceClock(at, startT)}`}
          data-testid="race-replay-map"
        />
        {hover && (
          <div className="debrief-tip" style={{ left: `${(hover.x / W) * 100}%`, top: `${(hover.y / H) * 100}%` }}>
            {hover.label}
          </div>
        )}
      </div>
      <div className="replay-bar">
        <button
          onClick={() => {
            playFrom.current = atEnd ? span.from : chosen;
            if (!playing && atEnd) setChosen(span.from);
            setPlaying(!playing);
          }}
          aria-label={playing ? 'Pause the replay' : 'Play the replay'}
          data-testid="race-replay-play"
        >
          {playing ? 'Pause' : atEnd ? 'Play from the start' : 'Play'}
        </button>
        <input
          type="range"
          min={span.from}
          max={span.to}
          step={1}
          value={at}
          onChange={(e) => {
            setPlaying(false);
            const v = Number(e.target.value);
            setChosen(v >= span.to ? undefined : v);
          }}
          aria-label="Moment of the race"
          aria-valuetext={raceClock(at, startT)}
          data-testid="race-replay-time"
        />
        <output className="replay-clock" data-testid="race-replay-clock">{raceClock(at, startT)}</output>
        <select className="replay-speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Replay speed" title="Replay speed">
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </div>
      <ul className="replay-legend" aria-label="The boats">
        {[...track.boats]
          .sort((a, b) => Number(b.you) - Number(a.you))
          .map((b) => (
            <li key={b.id}>
              <span className="swatch" style={{ background: b.you ? '#ffffff' : hex(b.colour) }} aria-hidden="true" />
              {b.label}
            </li>
          ))}
      </ul>
      <p className="fine">
        The race as it was sailed: each boat’s position kept once a second. Your track is the white one; point at a boat for her sail number. The
        orange lines are the course, with the way round.
      </p>
    </div>
  );
}
