/**
 * Screenshots of the set spinnaker for a sailor to check (fixes of 21 Nov 2026, §3.5): a broad run (true wind angle
 * 150°) on each gybe, the spinnaker hoisted and filled by the crew, seen from astern, abeam (the pole's side) and ahead.
 * Fixed scene and seed, so the same build makes the same pictures, at the Balanced preset. Simulator output, not a
 * photograph.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node tools/spinnaker-shots.mjs docs/img/fixes-21nov [quality]
 */
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'out/spinnaker-shots';
const quality = process.argv[3] ?? 'high';
mkdirSync(out, { recursive: true });
const exe = process.env.PW_CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

for (const [gybe, heading] of [['starboard', 75], ['port', 15]]) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 750 } });
  page.setDefaultTimeout(600_000);
  // The Balanced graphics preset (src/render/graphics.ts), as the hero and the social card (§3.6).
  await page.addInitScript(() => localStorage.setItem('squib.graphics.v1', JSON.stringify({ preset: 'balanced', resolutionScale: 1, maxPixelRatio: 1.5, scenery: 'high', shadows: 'standard', water: 'high', reflections: 'low', ambientOcclusion: false, hullFoam: true, spray: true, atmosphere: true, cameraMotion: 0.5 })));
  await page.goto(`${process.env.BASE ?? 'http://localhost:4173/'}?nowelcome&conditions=set&quality=${quality}`);
  await page.waitForFunction(() => window.__squib?.controller, null, { timeout: 400_000 });
  // The river data arriving can restart the run: wait for it first.
  await page.waitForFunction(() => window.__squib.controller.getState().dart.status !== 'loading', null, { timeout: 400_000 });
  await page.addStyleTag({ content: '.app > *:not(.viewport) { visibility: hidden !important; }' });
  // Wind 10 kn from 225°, steady: heading 75° is a broad run on starboard (TWA +150°), 15° on port (−150°).
  await page.evaluate((h) => {
    const c = window.__squib.controller;
    c.autoLowerGraphics = false;
    c.dynRes.enabled = false;
    c.view.setDynamicScale(1);
    cancelAnimationFrame(c.raf);
    c.raf = 0;
    const s = structuredClone(c.scenario);
    c.restart({ ...s, spinnaker: true, startLocation: 'start-bay-practice', startHeadingDeg: h, startSpeedKn: 4, conditions: { ...s.conditions, startTime: '2026-07-15T11:00:00Z', weather: { source: 'manual', twsKn: 10, twdDeg: 225 }, gusts: { preset: 'steady', seed: 1 }, current: { mode: 'none' } } });
    c.callSpinnaker(true);
    c.advance(30);
    if (!c.getState().paused) c.togglePause();
    c.setCamera('orbit');
  }, heading);
  const state = await page.evaluate(() => {
    const c = window.__squib.controller;
    return { phase: c.sim.spin.phase, fill: c.sim.spin.fill, side: c.sim.spin.poleSide, headingDeg: Math.round((c.sim.state.psi * 180) / Math.PI) };
  });
  console.log(gybe, JSON.stringify(state));
  for (const [view, fwd, side, up] of [['astern', -14, 0, 4], ['abeam', 0, 15, 3.5], ['ahead', 16, 0, 3]]) {
    await page.evaluate(({ fwd, side, up, poleSide }) => {
      const c = window.__squib.controller;
      const v = c.view;
      const b = v.boatRoot.position;
      // The boat's heading now (it has sailed 30 s with the helm central).
      const r = c.sim.state.psi;
      // Scene axes: x east, z south. Forward and the starboard side for a compass heading.
      const f = { x: Math.sin(r), z: -Math.cos(r) };
      const st = { x: Math.cos(r), z: Math.sin(r) };
      v.controls.target.set(b.x, b.y + 3.5, b.z);
      v.camera.position.set(b.x + f.x * fwd + st.x * side * poleSide, b.y + up, b.z + f.z * fwd + st.z * side * poleSide);
      v.controls.update();
      let t = performance.now();
      for (let i = 0; i < 6; i++) c.frame((t += 50));
    }, { fwd, side, up, poleSide: state.side });
    const file = join(out, `spinnaker-${gybe}-${view}.jpg`);
    await page.screenshot({ path: file, type: 'jpeg', quality: 84 });
    console.log('wrote', file);
  }
  await page.close();
}
await browser.close();
