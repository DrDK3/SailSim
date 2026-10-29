/**
 * Graphics benchmark and screenshots under fixed conditions (docs/GRAPHICS_REPORT.md §6). For each of eight
 * views it sails a fixed scenario (place, time, steady wind), points the camera, and times four frames, each
 * followed by a one-pixel read so the time includes the drawing, not only the submitting. It records draw calls,
 * triangles and three.js's geometry, texture and shader-program counts, and saves a screenshot of the view.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node tools/gfx-bench.mjs out/gfx [low|high] [view,view,...]
 *
 * Environment:
 * - BASE: the site (default http://localhost:4173/).
 * - GFX: graphics settings as JSON, stored before the page loads (src/render/graphics.ts), e.g. a preset's values.
 * - GPU=1: draw with the machine's graphics card in a visible window instead of the software renderer (SwiftShader).
 * - PW_CHROMIUM: the Chromium to use.
 *
 * Software-renderer times measure relative load only; compare builds on the same machine.
 */
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const out = process.argv[2] ?? 'out/gfx';
const quality = process.argv[3] ?? 'low';
const only = process.argv[4] ? process.argv[4].split(',') : null;
mkdirSync(out, { recursive: true });
const W = 1280;
const H = 720;
const gpu = process.env.GPU === '1';
const exe = process.env.PW_CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({ executablePath: exe, headless: !gpu, args: gpu ? ['--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
if (process.env.GFX) await page.addInitScript((g) => localStorage.setItem('squib.graphics.v1', g), process.env.GFX);
await page.goto(`${process.env.BASE ?? 'http://localhost:4173/'}?nowelcome&quality=${quality}`);
await page.waitForFunction(() => window.__squib?.controller.getState().dart.status === 'loaded', null, { timeout: 400_000 });
await page.waitForTimeout(1500);
// The benchmark drives the frames itself.
await page.evaluate(() => {
  const c = window.__squib.controller;
  cancelAnimationFrame(c.raf);
  c.raf = 0;
});
const hideUi = '.banner, .panel, .instruments, .controls, .toolbar, footer, .minimap, .dock, .status, .notice, .coach { visibility: hidden !important; }';
// name, start location, UTC time, wind (kn), wind from (deg), seconds sailed, camera, free camera offset from the boat
// in its own frame (x starboard, y up, z aft) and the height looked at.
const VIEWS = [
  ['chase-river', 'off-rdyc', '2026-07-15T10:00:00Z', 12, 225, 25, 'chase'],
  ['helm-river', 'off-rdyc', '2026-07-15T10:00:00Z', 12, 225, 25, 'helm'],
  ['sail-close', 'off-rdyc', '2026-07-15T10:00:00Z', 12, 225, 25, 'free', [7, 3.2, -3], 3.5],
  ['wake-stern', 'start-bay-practice', '2026-07-15T10:00:00Z', 16, 225, 40, 'free', [-4, 6, 22], 0],
  ['chase-sea', 'start-bay-practice', '2026-07-15T10:00:00Z', 16, 225, 40, 'chase'],
  ['golden-river', 'off-rdyc', '2026-07-15T19:30:00Z', 8, 270, 25, 'chase'],
  ['backlit-sails', 'off-rdyc', '2026-07-15T18:30:00Z', 10, 270, 25, 'sunback'],
  ['drone-harbour', 'off-rdyc', '2026-07-15T10:00:00Z', 12, 225, 25, 'drone'],
];
const results = [];
for (const [name, loc, time, tws, twd, secs, cam, off, lift] of VIEWS) {
  if (only && !only.includes(name)) continue;
  await page.evaluate(([loc, time, tws, twd, secs]) => {
    const c = window.__squib.controller;
    // A restart keeps the pause the last view left.
    if (c.paused) c.togglePause();
    c.restart({ ...c.scenario, course: undefined, fleet: undefined, startLocation: loc, conditions: { ...c.scenario.conditions, startTime: time, weather: { source: 'manual', twsKn: tws, twdDeg: twd }, gusts: { preset: 'steady', seed: 1 } } });
    c.advance(Math.max(0, secs - 8));
    // The last 8 s through drawn frames (a clock of its own, 10 a second), so the wake and the ride form as in
    // play; the scenery is hidden meanwhile to save time.
    let t = performance.now();
    c.lastFrame = t;
    const d = c.view.dart;
    const hidden = d ? [d.fixed, d.floating, d.labels] : [];
    for (const o of hidden) o.visible = false;
    for (let i = 0; i < 80; i++) {
      t += 100;
      c.frame(t);
    }
    for (const o of hidden) o.visible = true;
    if (!c.paused) c.togglePause();
    c.lastFrame = performance.now();
  }, [loc, time, tws, twd, secs]);
  await page.evaluate(([cam, off, lift]) => {
    const c = window.__squib.controller;
    const view = c.view;
    if (cam !== 'free' && cam !== 'sunback') return c.setCamera(cam);
    c.setCamera('chase');
    c.frame(performance.now());
    const b = view.boatRoot;
    if (cam === 'sunback') {
      // Low, on the side away from the sun, looking at the sails against it.
      const s = view.sunDir;
      return view.freeCamera([b.position.x - s.x * 14, 2.2, b.position.z - s.z * 14], [b.position.x, 3.5, b.position.z]);
    }
    const q = b.quaternion;
    const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
    const cs = Math.cos(yaw);
    const sn = Math.sin(yaw);
    view.freeCamera([b.position.x + off[0] * cs + off[2] * sn, off[1], b.position.z - off[0] * sn + off[2] * cs], [b.position.x, lift, b.position.z]);
  }, [cam, off ?? null, lift ?? 0]);
  // Settle: the sea-state field fills over frames and the sky is set once a second.
  await page.evaluate(async () => {
    const c = window.__squib.controller;
    c.lastWeather = -Infinity;
    for (let i = 0; i < 6; i++) {
      c.frame(performance.now());
      await new Promise((r) => setTimeout(r, 30));
    }
  });
  const m = await page.evaluate(() => {
    const c = window.__squib.controller;
    const r = c.view.renderer;
    const gl = r.getContext();
    const px = new Uint8Array(4);
    const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    c.frame(performance.now());
    sync();
    const N = 4;
    let submit = 0;
    let total = 0;
    for (let i = 0; i < N; i++) {
      const t0 = performance.now();
      c.frame(performance.now());
      const t1 = performance.now();
      sync();
      submit += t1 - t0;
      total += performance.now() - t0;
    }
    const info = r.info;
    return { submitMs: +(submit / N).toFixed(1), totalMs: +(total / N).toFixed(1), calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs?.length ?? null, pixelRatio: r.getPixelRatio() };
  });
  await page.addStyleTag({ content: hideUi });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 300_000 });
  results.push({ name, ...m });
  console.log(name, JSON.stringify(m));
  await page.evaluate(() => document.querySelectorAll('style').forEach((s) => s.textContent?.includes('visibility: hidden !important') && s.remove()));
}
writeFileSync(`${out}/bench.json`, JSON.stringify({ quality, W, H, gfx: process.env.GFX ?? null, gpu, results }, null, 1));
await browser.close();
