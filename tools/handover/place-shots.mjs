/**
 * Design handover of 23 Nov 2026, item 21: the viewpoint sheet's pictures. Water-level views (eye 1.6 m above the
 * water) of Dartmouth, Kingswear, Noss, Dittisham and the Start Bay approach, labels hidden, from fixed viewpoints, so
 * that local sailors can be asked to name the place, say how sure they are and name what misleads them, and so a later
 * build can be shot again from the same places. Software rendering (SwiftShader): they show what this renderer draws.
 *
 *   npx vite build && npx vite preview --port 4173 --strictPort &
 *   node tools/handover/place-shots.mjs [out=docs/handover-23nov/places] [BASE=http://localhost:4173/]
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'docs/handover-23nov/places';
const BASE = process.argv[3] ?? 'http://localhost:4173/';
mkdirSync(out, { recursive: true });
const exe = process.env.PW_CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

/** Viewpoints in the simulator's local metres (n north, e east of the RDYC clubhouse): the eye and the point looked at. */
export const VIEWPOINTS = [
  { id: 'dartmouth', place: 'Dartmouth waterfront (the Boatfloat and the Embankment)', eye: { n: 230, e: -120 }, at: { n: 300, e: -430 } },
  { id: 'kingswear', place: 'Kingswear (the village, the station and the pontoons)', eye: { n: 160, e: -260 }, at: { n: 170, e: 120 } },
  { id: 'noss', place: 'Noss (the marina)', eye: { n: 1500, e: -260 }, at: { n: 1850, e: -40 } },
  { id: 'dittisham', place: 'Dittisham (the waterfront and pontoon)', eye: { n: 3450, e: -1250 }, at: { n: 3850, e: -1650 } },
  { id: 'approach', place: 'The approach from Start Bay (the harbour mouth)', eye: { n: -2000, e: 1550 }, at: { n: -650, e: 700 } },
];

const page = await browser.newPage({ viewport: { width: 1200, height: 675 } });
page.setDefaultTimeout(600_000);
await page.goto(`${BASE}?nowelcome&conditions=set&quality=high`);
await page.waitForFunction(() => window.__squib?.controller.getState().dart.status === 'loaded', null, { timeout: 400_000 });
await page.addStyleTag({ content: '.app > *:not(.viewport) { visibility: hidden !important; }' });
await page.evaluate(() => {
  const c = window.__squib.controller;
  cancelAnimationFrame(c.raf);
  c.raf = 0;
  const s = structuredClone(c.scenario);
  c.restart({ ...s, startLocation: 'off-rdyc', startHeadingDeg: 170, startSpeedKn: 0, conditions: { ...s.conditions, startTime: '2026-07-15T12:00:00Z', weather: { source: 'manual', twsKn: 8, twdDeg: 225 }, gusts: { preset: 'steady', seed: 1 }, current: { mode: 'none' } } });
  c.toggleLabels(false);
  if (!c.getState().paused) c.togglePause();
});
for (const v of VIEWPOINTS) {
  await page.evaluate((v) => {
    const c = window.__squib.controller;
    if (c.view.mode !== 'free') c.setCamera('free');
    const view = c.view;
    view.controls.minDistance = 0.01;
    view.controls.target.set(v.at.e, 8, -v.at.n);
    view.camera.position.set(v.eye.e, 1.6, -v.eye.n);
    view.controls.update();
    let t = performance.now();
    for (let i = 0; i < 12; i++) c.frame((t += 50));
    view.camera.position.set(v.eye.e, 1.6, -v.eye.n);
    view.controls.target.set(v.at.e, 8, -v.at.n);
    view.controls.update();
    for (let i = 0; i < 4; i++) c.frame((t += 50));
  }, v);
  const file = join(out, `${v.id}.jpg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: 80 });
  console.log('wrote', file);
}
await browser.close();
