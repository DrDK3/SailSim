import { useEffect, useRef, useState } from 'react';
import type { SimController, UiState } from '../app/controller';
import { ferryStates } from '../app/ferrySchedule';
import { chartSpec, drawChart, minimapLabels } from './minimapChart';
import { SHIP_BUOYS, tenderOutline, yachtOutline } from '../sim/env/shipBuoys';
import { isletOutlines } from '../sim/env/islets';
import { KINGSWEAR_LIGHT, kingswearLightLocal, kingswearRockOutline } from '../sim/env/shoreLights';
import { notABuilding } from '../sim/env/notBuildings';
import { DAYMARK } from '../render/daymark';
import { DART_PROJECTION } from '../sim/geo/projection';

const W = 220;
const H = 250;
/** Visible width of the map in metres at each zoom step. */
const SPANS = [600, 1200, 2500, 6800];

/**
 * North-up overview: a chart drawn from the sim's own ground (src/ui/minimapChart.ts; the pipeline's picture until
 * it is ready), the boat and its course over ground, the other boats of the fleet, ferries (amber = restricted in
 * ability to manoeuvre), the navigation marks that have a stated position, the ship buoys and the yacht on them,
 * the Kingswear light with its white sector, the Daymark, and the places' names.
 */
export function Minimap({ ctl, ui }: { ctl: SimController; ui: UiState }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [chart, setChart] = useState<{ canvas: HTMLCanvasElement; e0: number; nTop: number; w: number; h: number } | null>(null);
  const data = ctl.dartData;

  // The chart, once, after the river has loaded and where the minimap shows (it is hidden on phones).
  useEffect(() => {
    const geo = data?.geo;
    const m = data?.manifest;
    if (!geo || !m || chart || ui.dart.status !== 'loaded') return;
    if (canvas.current && canvas.current.offsetParent === null) return;
    const id = window.setTimeout(() => {
      const s = chartSpec(m.domain);
      const c = drawChart((n, e) => geo.bedElevation(n, e), s, -geo.cdBelowOdn, {
        buildings: data.features?.buildings.filter((b) => !notABuilding(b.r)),
        roads: data.roads?.roads,
        rocks: [...isletOutlines().map((o) => o.ring), kingswearRockOutline()],
      });
      setChart({ canvas: c, e0: s.e0, nTop: s.nTop, w: s.nx * s.cell, h: s.ny * s.cell });
    }, 30);
    return () => window.clearTimeout(id);
  }, [data, chart, ui.dart.status]);
  const labels = useRef(minimapLabels());

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
    // Sharp on high-density screens: the canvas at the device's pixels, drawn in CSS pixels.
    const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    if (c.width !== Math.round(W * dpr)) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const s = ui.snapshot;
    const span = SPANS[zoom]!;
    const k = W / span; // px per metre
    const toPx = (n: number, e: number) => [W / 2 + (e - s.e) * k, H / 2 - (n - s.n) * k] as const;
    ctx.fillStyle = '#184266';
    ctx.fillRect(0, 0, W, H);
    if (chart) {
      const [x0, y0] = toPx(chart.nTop, chart.e0);
      const [x1, y1] = toPx(chart.nTop - chart.h, chart.e0 + chart.w);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(chart.canvas, x0, y0, x1 - x0, y1 - y0);
    } else if (img) {
      const [x0, y0] = toPx(m.domain.nMax, m.domain.eMin);
      const [x1, y1] = toPx(m.domain.nMin, m.domain.eMax);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(img, x0, y0, x1 - x0, y1 - y0);
    }
    // The Kingswear light: its sectors (bearings of the light from seaward, so drawn out from it the other way),
    // green, white and red, as faint wedges between dashed limits, and the light as a chart marks one, a magenta flare.
    const kl = kingswearLightLocal();
    const [lx, ly] = toPx(kl.n, kl.e);
    const reach = Math.min(1500 * k, W);
    const ray = (b: number) => [lx + Math.sin(((b + 180) * Math.PI) / 180) * reach, ly - Math.cos(((b + 180) * Math.PI) / 180) * reach] as const;
    const SECTOR_FILL = { green: 'rgba(70,220,110,0.24)', white: 'rgba(255,255,240,0.15)', red: 'rgba(250,60,45,0.32)' } as const;
    for (const sec of KINGSWEAR_LIGHT.sectors) {
      const [a0, a1] = [ray(sec.from), ray(sec.to)];
      ctx.fillStyle = SECTOR_FILL[sec.colour];
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.lineTo(a0[0], a0[1]);
      ctx.lineTo(a1[0], a1[1]);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,255,240,0.55)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    for (const b of new Set(KINGSWEAR_LIGHT.sectors.flatMap((x) => [x.from, x.to]))) {
      const [ex, ey] = ray(b);
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = '#d23fd0';
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.quadraticCurveTo(lx - 7, ly + 3, lx - 6, ly + 8);
    ctx.quadraticCurveTo(lx - 2, ly + 6, lx, ly);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#0b1a24';
    ctx.beginPath();
    ctx.arc(lx, ly, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // The Daymark: a beacon tower.
    const dm = DART_PROJECTION.toLocal(DAYMARK.lat, DAYMARK.lon);
    const [dx, dy] = toPx(dm.n, dm.e);
    ctx.fillStyle = '#efe9da';
    ctx.strokeStyle = '#0b1a24';
    ctx.beginPath();
    ctx.moveTo(dx, dy - 6);
    ctx.lineTo(dx + 3, dy + 2);
    ctx.lineTo(dx - 3, dy + 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // The yacht on the ship buoys (and her tender), and the buoys: yellow, as they are.
    const poly = (r: readonly [number, number][]) => {
      ctx.beginPath();
      r.forEach(([e, n], i) => {
        const [x, y] = toPx(n, e);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.closePath();
    };
    ctx.fillStyle = '#f4f3ee';
    ctx.lineWidth = 0.8;
    for (const r of [yachtOutline(), tenderOutline()]) {
      poly(r);
      ctx.fill();
      ctx.stroke();
    }
    for (const b of SHIP_BUOYS) {
      const [x, y] = toPx(b.n, b.e);
      ctx.fillStyle = '#f2c21b';
      ctx.beginPath();
      ctx.arc(x, y, Math.max(2, 1.5 * k), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    const f = data.features;
    if (f) {
      for (const mk of f.marks) {
        const [x, y] = toPx(mk.n, mk.e);
        const c = mk.colour ?? (/starboard/i.test(mk.kind) ? 'green' : 'red');
        const shape = mk.shape ?? (/starboard/i.test(mk.kind) ? 'cone' : 'can');
        ctx.fillStyle = c === 'green' ? '#2fbf5a' : c === 'yellow' ? '#f2c21b' : c === 'south-cardinal' ? '#d8b020' : '#e0403a';
        ctx.strokeStyle = '#0b1a24';
        ctx.lineWidth = 1;
        // The shape as on a chart, not the colour alone (review U8): a can square, a cone pointed, a cardinal a
        // diamond, a buoy of unstated shape round.
        ctx.beginPath();
        if (c === 'south-cardinal') {
          ctx.moveTo(x, y - 5);
          ctx.lineTo(x + 4, y);
          ctx.lineTo(x, y + 5);
          ctx.lineTo(x - 4, y);
          ctx.closePath();
        } else if (shape === 'cone') {
          ctx.moveTo(x, y - 5);
          ctx.lineTo(x - 4, y + 3);
          ctx.lineTo(x + 4, y + 3);
          ctx.closePath();
        } else if (shape === 'can') {
          ctx.rect(x - 3.5, y - 3.5, 7, 7);
        } else {
          ctx.arc(x, y, 3.5, 0, Math.PI * 2);
        }
        ctx.fill();
        ctx.stroke();
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
    // The places' names, at the zooms they suit, with a dark halo so they read on land and water.
    ctx.font = '600 10px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const l of labels.current) {
      if (!l.zooms.includes(zoom)) continue;
      const [x0, y] = toPx(l.n, l.e);
      if (x0 < -40 || x0 > W + 40 || y < -10 || y > H + 10) continue;
      // Kept whole inside the map near its edges.
      const half = ctx.measureText(l.text).width / 2 + 3;
      const x = Math.min(W - half, Math.max(half, x0));
      ctx.strokeStyle = 'rgba(8,20,28,0.85)';
      ctx.lineWidth = 3;
      ctx.strokeText(l.text, x, y);
      ctx.fillStyle = '#f2efe6';
      ctx.fillText(l.text, x, y);
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
    ctx.fillStyle = s.grounded ? '#f0625a' : '#ffffff';
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
  }, [ui.snapshot, ui.fleet, zoom, img, chart, data, ctl]);

  if (ui.dart.status !== 'loaded' || !data?.manifest) return null;
  // The scale, under the map rather than drawn on it (owner review, 5 Nov 2026: its figures ran onto the map):
  // a bar a quarter of the map's width and its length.
  const bar = SPANS[zoom]! / 4;
  return (
    <section className="panel minimap" aria-label="Minimap">
      <canvas ref={canvas} width={W} height={H} data-testid="minimap" role="img" aria-label="Map of the River Dart around the boat, north up" />
      <div className="minimap-bar">
        <button onClick={() => setZoom(Math.max(0, zoom - 1))} aria-label="Zoom in" disabled={zoom === 0}>+</button>
        <button onClick={() => setZoom(Math.min(SPANS.length - 1, zoom + 1))} aria-label="Zoom out" disabled={zoom === SPANS.length - 1}>−</button>
        <span className="map-scale" data-testid="minimap-scale" title="Scale of the map">
          <span className="map-scale-bar" aria-hidden="true" />
          {bar >= 1000 ? `${bar / 1000} km` : `${bar} m`}
        </span>
        <span className="map-north" title="North is up">N↑</span>
      </div>
      <div className="fine-inline minimap-note">Not for navigation</div>
    </section>
  );
}
