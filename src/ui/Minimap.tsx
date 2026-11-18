import { useEffect, useRef, useState } from 'react';
import type { SimController, UiState } from '../app/controller';
import { ferryStates } from '../app/ferrySchedule';
import { chartSpec, drawChart, minimapLabels } from './minimapChart';
import { SHIP_BUOYS, tenderOutline, yachtOutline } from '../sim/env/shipBuoys';
import { isletOutlines } from '../sim/env/islets';
import { SECTOR_LIGHTS, kingswearRockOutline, lightLocal } from '../sim/env/shoreLights';
import { notABuilding } from '../sim/env/notBuildings';
import { DAYMARK } from '../render/daymark';
import { DART_PROJECTION } from '../sim/geo/projection';
import { coursePoints, fitCourse } from '../app/courseFit';
import { drawCourse } from './courseMap';

const W = 220;
const H = 250;
/** Visible width of the map in metres at each zoom step. */
const SPANS = [600, 1200, 2500, 6800];

/**
 * North-up overview: a chart drawn from the sim's own ground (src/ui/minimapChart.ts; the pipeline's picture until
 * it is ready), the boat and its course over ground, the other boats of the fleet, ferries (amber = restricted in
 * ability to manoeuvre), the navigation marks that have a stated position, the ship buoys and the yacht on them,
 * the Kingswear light with its white sector, the Daymark, and the places' names.
 *
 * In a race the map shows the course (owner, 18 Nov 2026: it was "an almost empty blue square in open water"): by
 * default the whole course fitted into the map with the boat moving over it, the legs drawn with the way round, the
 * marks named, the next mark ringed and, with the race aids on, the laylines to it. "+" and "−" go back to the map
 * that follows the boat; "Course" returns to the whole course.
 */
export function Minimap({ ctl, ui }: { ctl: SimController; ui: UiState }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  // In a race: the whole course fitted into the map (the default), or the map following the boat.
  const [courseView, setCourseView] = useState(true);
  const [fitSpan, setFitSpan] = useState<number>();
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
    const race = ctl.race;
    // The river's map needs the river; a course can be drawn on open water without it.
    if (!c || (!m && !race)) return;
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
    const fit = race && courseView ? fitCourse(coursePoints(race.resolved), { n: s.n, e: s.e }, { w: W, h: H }) : undefined;
    if (fit?.span !== fitSpan) setFitSpan(fit?.span);
    const span = fit?.span ?? SPANS[zoom]!;
    const k = W / span; // px per metre
    const centre = fit ?? { n: s.n, e: s.e };
    const toPx = (n: number, e: number) => [W / 2 + (e - centre.e) * k, H / 2 - (n - centre.n) * k] as const;
    ctx.fillStyle = '#184266';
    ctx.fillRect(0, 0, W, H);
    if (chart) {
      const [x0, y0] = toPx(chart.nTop, chart.e0);
      const [x1, y1] = toPx(chart.nTop - chart.h, chart.e0 + chart.w);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(chart.canvas, x0, y0, x1 - x0, y1 - y0);
    } else if (img && m) {
      const [x0, y0] = toPx(m.domain.nMax, m.domain.eMin);
      const [x1, y1] = toPx(m.domain.nMin, m.domain.eMax);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(img, x0, y0, x1 - x0, y1 - y0);
    }
    // The sector lights (the Kingswear light; Bayard's Cove light, estimated): their sectors (bearings of the light
    // from seaward, so drawn out from it the other way), green, white and red, as faint wedges between dashed limits,
    // and each light as a chart marks one, a magenta flare.
    const SECTOR_FILL = { green: 'rgba(70,220,110,0.24)', white: 'rgba(255,255,240,0.15)', red: 'rgba(250,60,45,0.32)' } as const;
    for (const light of SECTOR_LIGHTS) {
      const kl = lightLocal(light);
      const [lx, ly] = toPx(kl.n, kl.e);
      const reach = Math.min(1500 * k, W);
      const ray = (b: number) => [lx + Math.sin(((b + 180) * Math.PI) / 180) * reach, ly - Math.cos(((b + 180) * Math.PI) / 180) * reach] as const;
      for (const sec of light.sectors) {
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
      for (const b of new Set(light.sectors.flatMap((x) => [x.from, x.to]))) {
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
    }
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
    const f = data?.features;
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
    // The course: its legs with the way round, both lines, the marks named, the next mark ringed, and the laylines
    // to it with the race aids on (src/ui/courseMap.ts). Names when the map is close enough to read them.
    if (race) {
      const judge = race.session.judgeOf('you');
      drawCourse(ctx, race.resolved, toPx, {
        legIndex: judge.phase === 'pre-start' ? undefined : judge.legIndex,
        ringNext: judge.phase === 'racing',
        names: span <= 3200,
        laylines: ctl.raceLaylines?.lines,
      });
    }
    // The places' names, at the zooms they suit, with a dark halo so they read on land and water.
    ctx.font = '600 10px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    // The zoom step the places' names go by: in the course view, the nearest step to the width shown.
    const labelZoom = fit ? SPANS.reduce((best, sp, i) => (Math.abs(sp - span) < Math.abs(SPANS[best]! - span) ? i : best), 0) : zoom;
    for (const l of labels.current) {
      if (!l.zooms.includes(labelZoom)) continue;
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
  }, [ui.snapshot, ui.fleet, ui.raceAids, zoom, courseView, fitSpan, img, chart, data, ctl]);

  const racing = !!ui.race;
  if (!racing && (ui.dart.status !== 'loaded' || !data?.manifest)) return null;
  const fitted = racing && courseView && fitSpan !== undefined;
  // The scale, under the map rather than drawn on it (owner review, 5 Nov 2026: its figures ran onto the map):
  // a bar a quarter of the map's width and its length.
  const bar = (fitted ? fitSpan : SPANS[zoom]!) / 4;
  // Leaving the course view: the nearest step of the boat's map, then one in or out.
  const step = (d: number) => {
    const from = fitted ? SPANS.reduce((best, sp, i) => (Math.abs(sp - fitSpan) < Math.abs(SPANS[best]! - fitSpan) ? i : best), 0) : zoom;
    setCourseView(false);
    setZoom(Math.max(0, Math.min(SPANS.length - 1, from + d)));
  };
  return (
    <section className="panel minimap" aria-label="Minimap">
      <canvas
        ref={canvas}
        width={W}
        height={H}
        data-testid="minimap"
        data-view={fitted ? 'course' : 'boat'}
        role="img"
        aria-label={fitted ? 'Map of the whole race course, north up: the legs, the marks, the fleet and your boat' : 'Map of the River Dart around the boat, north up'}
      />
      <div className="minimap-bar">
        <button onClick={() => step(-1)} aria-label="Zoom in" disabled={!fitted && zoom === 0}>+</button>
        <button onClick={() => step(1)} aria-label="Zoom out" disabled={!fitted && zoom === SPANS.length - 1}>−</button>
        <span className="map-scale" data-testid="minimap-scale" title="Scale of the map">
          <span className="map-scale-bar" aria-hidden="true" />
          {bar >= 1000 ? `${bar / 1000} km` : `${bar} m`}
        </span>
        <span className="map-north" title="North is up">N↑</span>
      </div>
      <div className="minimap-foot">
        {racing && (
          <button className={`map-course${courseView ? ' on' : ''}`} onClick={() => setCourseView(!courseView)} aria-pressed={courseView} title="The whole course in the map, or the map following the boat" aria-label="Show the whole course" data-testid="minimap-course">
            Course
          </button>
        )}
        <span className="fine-inline minimap-note">Not for navigation</span>
      </div>
    </section>
  );
}
