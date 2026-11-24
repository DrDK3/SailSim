/**
 * The mainsail eased on a reach and a broad reach, seen from astern and above (owner, 24 Nov 2026: "the sail passes
 * through the support stays"). Software rendering: for comparing builds, not a measure of how it looks on a device.
 *   npx vite build && npx vite preview --port 4173 --strictPort &
 *   node tools/shroud-shots.mjs <out dir> <tag>
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
const [out, tag] = [process.argv[2] ?? 'out/shroud-shots', process.argv[3] ?? 'shot'];
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 800, height: 1000 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(600_000);
await page.goto('http://localhost:4173/?nowelcome&conditions=set&quality=high');
await page.waitForFunction(() => window.__squib?.controller.getState().dart.status === 'loaded', null, { timeout: 400_000 });
await page.addStyleTag({ content: '.app > *:not(.viewport) { visibility: hidden !important; }' });
/** A camera in the boat's model frame (x starboard, y up, z aft), looking at a point in it (as tools/rig-shots.mjs). */
const boatCam = (eye, target) =>
  page.evaluate(
    ({ eye, target }) => {
      const c = window.__squib.controller;
      if (c.view.mode !== 'free') c.setCamera('free');
      const v = c.view;
      const g = v.boat.group;
      g.updateMatrixWorld(true);
      const V = v.camera.position.constructor;
      v.controls.minDistance = 0.01;
      v.camera.near = 0.05;
      v.camera.updateProjectionMatrix();
      v.camera.position.copy(g.localToWorld(new V(...eye)));
      v.controls.target.copy(g.localToWorld(new V(...target)));
      v.controls.update();
    },
    { eye, target },
  );
const frames = (n = 8) =>
  page.evaluate((n) => {
    const c = window.__squib.controller;
    let t = performance.now();
    for (let i = 0; i < n; i++) c.frame((t += 50));
  }, n);

for (const [name, heading, tws] of [['reach', 95, 6], ['broad', 75, 5]]) {
  const boom = await page.evaluate(({ heading, tws }) => {
    const c = window.__squib.controller;
    cancelAnimationFrame(c.raf);
    c.raf = 0;
    if (c.getState().paused) c.togglePause();
    const s = structuredClone(c.scenario);
    c.restart({ ...s, startLocation: 'off-rdyc', startHeadingDeg: heading, startSpeedKn: 3, conditions: { ...s.conditions, startTime: '2026-07-15T12:00:00Z', weather: { source: 'manual', twsKn: tws, twdDeg: 225 }, gusts: { preset: 'steady', seed: 1 }, current: { mode: 'none' } } });
    c.setInput({ autoMain: true, autoJib: true, autoCrew: true });
    c.advance(12);
    if (!c.getState().paused) c.togglePause();
    return ((c.sim.snapshot(false).boomMain * 180) / Math.PI).toFixed(0);
  }, { heading, tws });
  await boatCam([0, 7.5, 9], [0, 3.5, -0.5]);
  await frames(2);
  await boatCam([0, 7.5, 9], [0, 3.5, -0.5]);
  await frames();
  await page.screenshot({ path: `${out}/${name}-${tag}.png` });
  console.log(name, tag, 'boom', boom);
}
await browser.close();
