import { useEffect, useRef, useState } from 'react';
import type { SimController, UiState } from '../app/controller';
import { ferryStates } from '../app/ferrySchedule';

const W = 220;
const H = 250;
/** Visible width of the map in metres at each zoom step. */
const SPANS = [1200, 2500, 6800];

/**
 * North-up overview drawn from the pipeline's minimap image: the boat and its course over ground, the other boats
 * of the fleet, ferries (amber = restricted in ability to manoeuvre) and the navigation marks that have a
 * stated position.
 */
export function Minimap({ ctl, ui }: { ctl: SimController; ui: UiState }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const data = ctl.dartData;

  useEffect(() => {
    if (!data?.minimapUrl) return;
    const im = new Image();
    im.onload = () => setImg(im);
    im.src = data.minimapUrl;
  }, [data?.minimapUrl]);

  useEffect(() => {
    const c = canvas.current;
    const m = data?.manifest;
    if (!c || !m) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const s = ui.snapshot;
    const span = SPANS[zoom]!;
    const k = W / span; // px per metre
    const toPx = (n: number, e: number) => [W / 2 + (e - s.e) * k, H / 2 - (n - s.n) * k] as const;
    ctx.fillStyle = '#1f4b6b';
    ctx.fillRect(0, 0, W, H);
    if (img) {
      const [x0, y0] = toPx(m.domain.nMax, m.domain.eMin);
      const [x1, y1] = toPx(m.domain.nMin, m.domain.eMax);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(img, x0, y0, x1 - x0, y1 - y0);
    }
    const f = data.features;
    if (f) {
      for (const mk of f.marks) {
        const [x, y] = toPx(mk.n, mk.e);
        ctx.fillStyle = /starboard/i.test(mk.kind) ? '#2fbf5a' : '#e0403a';
        ctx.beginPath();
        ctx.moveTo(x, y - 5);
        ctx.lineTo(x - 4, y + 3);
        ctx.lineTo(x + 4, y + 3);
        ctx.closePath();
        ctx.fill();
      }
      const epoch = (ctl.sim.env.startEpochMs ?? 0) + s.t * 1000;
      for (const fs of ctl.traffic ? ctl.traffic.states(epoch) : ferryStates(f.ferries, epoch)) {
        const [x, y] = toPx(fs.n, fs.e);
        if (x < -10 || x > W + 10 || y < -10 || y > H + 10) continue;
        ctx.fillStyle = fs.ram ? '#f2b84b' : '#e8eef2';
        ctx.strokeStyle = '#0b1a24';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    // Course: legs (lap 1), lines and marks; the next mark ringed.
    const race = ctl.race;
    if (race) {
      const r = race.resolved;
      ctx.strokeStyle = 'rgba(255,170,90,0.75)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      const sm = { n: (r.start[0].n + r.start[1].n) / 2, e: (r.start[0].e + r.start[1].e) / 2 };
      let [px, py] = toPx(sm.n, sm.e);
      ctx.moveTo(px, py);
      for (const l of r.legs.filter((x) => x.lap === 1)) {
        [px, py] = toPx(l.target.n, l.target.e);
        ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      for (const [a, b] of [r.start, r.finish]) {
        const [x0, y0] = toPx(a.n, a.e);
        const [x1, y1] = toPx(b.n, b.e);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
      ctx.lineWidth = 1;
      for (const p of r.pos.values()) {
        const [x, y] = toPx(p.n, p.e);
        ctx.fillStyle = '#ff7a1a';
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      const judge = race.session.judgeOf('you');
      const next = r.legs[judge.legIndex];
      if (next && judge.phase === 'racing') {
        const [x, y] = toPx(next.target.n, next.target.e);
        ctx.strokeStyle = '#5fe08a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 1;
      }
    }
    // The other boats of the fleet, in their hull colours.
    for (const b of ui.fleet) {
      const [fx, fy] = toPx(b.n, b.e);
      if (fx < -10 || fx > W + 10 || fy < -10 || fy > H + 10) continue;
      ctx.save();
      ctx.translate(fx, fy);
      ctx.rotate(b.heading);
      ctx.fillStyle = `#${b.colour.toString(16).padStart(6, '0')}`;
      ctx.strokeStyle = '#0b1a24';
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(3.5, 4);
      ctx.lineTo(-3.5, 4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    // Course over ground (60 s ahead) and the boat.
    const [bx, by] = toPx(s.n, s.e);
    const ahead = s.sog * 60 * k;
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + Math.sin(s.cog) * ahead, by - Math.cos(s.cog) * ahead);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(s.heading);
    ctx.fillStyle = s.grounded ? '#ff6b5e' : '#ffffff';
    ctx.strokeStyle = '#0b1a24';
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // Scale bar
    const bar = span / 4;
    ctx.fillStyle = 'rgba(8,18,26,0.7)';
    ctx.fillRect(6, H - 20, bar * k + 34, 14);
    ctx.fillStyle = '#eef3f6';
    ctx.fillRect(10, H - 12, bar * k, 2);
    ctx.font = '10px Inter, system-ui, sans-serif';
    ctx.fillText(bar >= 1000 ? `${bar / 1000} km` : `${bar} m`, 14 + bar * k, H - 9);
  }, [ui.snapshot, ui.fleet, zoom, img, data, ctl]);

  if (ui.dart.status !== 'loaded' || !data?.manifest) return null;
  return (
    <section className="panel minimap" aria-label="Minimap">
      <canvas ref={canvas} width={W} height={H} data-testid="minimap" role="img" aria-label="Map of the River Dart around the boat, north up" />
      <div className="minimap-bar">
        <button onClick={() => setZoom(Math.max(0, zoom - 1))} aria-label="Zoom in" disabled={zoom === 0}>+</button>
        <button onClick={() => setZoom(Math.min(SPANS.length - 1, zoom + 1))} aria-label="Zoom out" disabled={zoom === SPANS.length - 1}>−</button>
        <span className="fine-inline">North up · not for navigation</span>
      </div>
    </section>
  );
}
