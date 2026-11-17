/**
 * Cue screenshots at fixed seeds (juniors round §5.3): a gust approaching on the water, a luffing sail, a flogging
 * sail, a tack in progress and spray in a fresh wind, at each graphics preset. Software rendering (SwiftShader) unless
 * GPU=1: these show what the software renderer draws, nothing more.
 *
 *   npx vite build && npx vite preview --port 4173 --strictPort &
 *   node tools/cue-shots.mjs out/cues [presets]
 */
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const out = process.argv[2] ?? 'out/cues';
const presets = (process.argv[3] ?? 'performance,balanced,ultra').split(',');
mkdirSync(out, { recursive: true });
const PRESETS = {
  performance: { resolutionScale: 0.75, maxPixelRatio: 1, scenery: 'low', shadows: 'standard', water: 'low', reflections: 'off', ambientOcclusion: false, hullFoam: true, spray: true, atmosphere: true },
  balanced: { resolutionScale: 1, maxPixelRatio: 1.5, scenery: 'high', shadows: 'standard', water: 'high', reflections: 'low', ambientOcclusion: false, hullFoam: true, spray: true, atmosphere: true },
  ultra: { resolutionScale: 1, maxPixelRatio: 2, scenery: 'high', shadows: 'fine', water: 'high', reflections: 'high', ambientOcclusion: true, hullFoam: true, spray: true, atmosphere: true },
};
// name, wind kn, from, gusts, seed, heading, seconds sailed, then what: 'release' (sheets out), 'tack' (helm over until
// the boom crosses), nothing; camera height and distance (chase).
const SHOTS = [
  ['puff-approaching', 14, 225, 'gusty', 4, 315, 45, null],
  ['luffing-sail', 10, 225, 'steady', 1, 300, 20, 'ease'],
  ['flogging-sail', 12, 225, 'steady', 1, 225, 15, 'release'],
  ['tack-in-progress', 12, 225, 'steady', 1, 270, 20, 'tack'],
  ['spray-fresh-wind', 22, 225, 'moderate', 2, 135, 40, null],
];
const exe = process.env.PW_CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const gpu = process.env.GPU === '1';
const results = [];
for (const p of presets) {
  const browser = await chromium.launch({ executablePath: exe, headless: !gpu, args: gpu ? ['--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.addInitScript((g) => {
    localStorage.setItem('squib.welcomed.v1', '1');
    localStorage.setItem('squib.graphics.v1', g);
  }, JSON.stringify({ preset: p, cameraMotion: 0.5, ...PRESETS[p] }));
  await page.goto(`${process.env.BASE ?? 'http://localhost:4173/'}?nowelcome&quality=${p === 'performance' ? 'low' : 'high'}`);
  await page.waitForFunction(() => window.__squib?.controller.getState().dart.status === 'loaded', null, { timeout: 600_000 });
  await page.evaluate(() => {
    const c = window.__squib.controller;
    c.setAutoLowerGraphics(false);
    cancelAnimationFrame(c.raf);
    c.raf = 0;
  });
  for (const [name, tws, twd, gusts, seed, heading, secs, act] of SHOTS) {
    const r = await page.evaluate(([tws, twd, gusts, seed, heading, secs, act]) => {
      const c = window.__squib.controller;
      if (c.paused) c.togglePause();
      c.restart({ conditions: { startTime: '2026-07-15T12:00:00Z', weather: { source: 'manual', twsKn: tws, twdDeg: twd }, gusts: { preset: gusts, seed }, current: { mode: 'none' }, sky: { source: 'preset', preset: 'fair' } }, startLocation: 'start-bay-practice', startHeadingDeg: heading, startSpeedKn: 4 });
      c.setInput({ autoMain: true, autoJib: true, autoCrew: true });
      c.advance(Math.max(0, secs - 8));
      if (act === 'ease') c.setInput({ autoMain: false, autoJib: false, mainSheet: 0.85, jibSheet: 0.85 });
      if (act === 'release') c.releaseSheets();
      // The last 8 s through drawn frames (10 a second), so wake, spray and the sails' motion form as in play.
      let t = performance.now();
      c.lastFrame = t;
      const d = c.view.dart;
      const hidden = d ? [d.fixed, d.floating, d.labels] : [];
      for (const o of hidden) o.visible = false;
      const side0 = c.sim.snapshot(false).mainSide;
      if (act === 'tack') c.press(c.sim.snapshot(false).twa >= 0 ? 'helmRight' : 'helmLeft', true);
      for (let i = 0; i < 80; i++) {
        t += 100;
        c.frame(t);
        // Stop just after the boom crosses (a tack in progress).
        if (act === 'tack' && c.sim.snapshot(false).mainSide !== side0) {
          c.press('helmRight', false);
          c.press('helmLeft', false);
          break;
        }
      }
      for (const o of hidden) o.visible = true;
      c.frame((t += 16));
      if (!c.paused) c.togglePause();
      c.frame((t += 16));
      const q = c.view.cues;
      return { luffMain: +q.main.luff.toFixed(2), luffJib: +q.jib.luff.toFixed(2), gust: +q.wind.gust.toFixed(2), stw: +q.stw.toFixed(2), spray: Math.round(q.sprayRate), manoeuvre: q.manoeuvre, puffsDrawn: c.view.water.drawnPuffs().length };
    }, [tws, twd, gusts, seed, heading, secs, act]);
    await page.addStyleTag({ content: '.banner, .panel, .instruments, .controls, .toolbar, footer, .minimap, .dock, .status, .notice, .coach { visibility: hidden !important; }' });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/${p}-${name}.png`, timeout: 300_000 });
    await page.evaluate(() => document.querySelectorAll('style').forEach((s) => s.textContent?.includes('visibility: hidden !important') && s.remove()));
    results.push({ preset: p, shot: name, ...r });
    console.log(p, name, JSON.stringify(r));
  }
  await browser.close();
}
writeFileSync(`${out}/cues.json`, JSON.stringify({ renderer: gpu ? 'GPU' : 'SwiftShader (software)', results }, null, 1));
