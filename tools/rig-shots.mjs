/**
 * Before-and-after pictures for the owner's three points of 22 Nov 2026 (flags along their staffs, the foot of the
 * mast, rigging through the crew): the same scenes from a build, in Chromium's software renderer. Each scene is fixed
 * (place, time, wind, camera), so two builds draw comparable pictures.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node tools/rig-shots.mjs <out dir> <tag> [base URL]
 */
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'out/rig-shots';
const tag = process.argv[3] ?? 'shot';
const BASE = process.argv[4] ?? 'http://localhost:4173/';
mkdirSync(out, { recursive: true });
const exe = process.env.PW_CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

async function open(width = 900, height = 600) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.setDefaultTimeout(600_000);
  await page.goto(`${BASE}?nowelcome&conditions=set&quality=high`);
  await page.waitForFunction(() => window.__squib?.controller.getState().dart.status === 'loaded', null, { timeout: 400_000 });
  await page.addStyleTag({ content: '.app > *:not(.viewport) { visibility: hidden !important; }' });
  await page.evaluate(() => {
    const c = window.__squib.controller;
    cancelAnimationFrame(c.raf);
    c.raf = 0;
  });
  return page;
}

/** Sail a moment in a fixed scene, then pause. */
const scene = (page, { loc = 'start-bay-practice', heading = 180, tws = 10, twd = 225, secs = 10 } = {}) =>
  page.evaluate(
    ({ loc, heading, tws, twd, secs }) => {
      const c = window.__squib.controller;
      if (c.getState().paused) c.togglePause();
      const s = structuredClone(c.scenario);
      c.restart({ ...s, startLocation: loc, startHeadingDeg: heading, startSpeedKn: 3, conditions: { ...s.conditions, startTime: '2026-07-15T12:00:00Z', weather: { source: 'manual', twsKn: tws, twdDeg: twd }, gusts: { preset: 'steady', seed: 1 }, current: { mode: 'none' } } });
      c.advance(secs);
      if (!c.getState().paused) c.togglePause();
    },
    { loc, heading, tws, twd, secs },
  );

/** A camera in the boat's model frame (x starboard, y up, z aft), looking at a point in it. */
const boatCam = (page, eye, target) =>
  page.evaluate(
    ({ eye, target }) => {
      const c = window.__squib.controller;
      if (c.view.mode !== 'free') c.setCamera('free');
      const v = c.view;
      const g = v.boat.group;
      g.updateMatrixWorld(true);
      const V = v.camera.position.constructor;
      v.controls.minDistance = 0.01;
      v.camera.near = 0.02;
      v.camera.updateProjectionMatrix();
      v.camera.position.copy(g.localToWorld(new V(...eye)));
      v.controls.target.copy(g.localToWorld(new V(...target)));
      v.controls.update();
    },
    { eye, target },
  );

/** Draw frames, advancing the picture's own clock (the crew settle into their places) while the boat is paused. */
const frames = (page, n = 8) =>
  page.evaluate((n) => {
    const c = window.__squib.controller;
    let t = performance.now();
    for (let i = 0; i < n; i++) c.frame((t += 50));
  }, n);

/** Hold the crew's weight on the centreline and the boom eased (a light-air reach), whatever the boat is doing. */
const lightReach = (page) =>
  page.evaluate(() => {
    const b = window.__squib.controller.view.boat;
    const update = b.update.bind(b);
    let clock = 0;
    b.update = (p) => update({ ...p, crewY: 0.02, crewTo: 0.02, main: { ...p.main, angle: -0.5 }, jib: { ...p.jib, angle: -0.4 }, time: (clock += 1 / 20) });
  });

const shot = async (page, name) => {
  const file = join(out, `${name}-${tag}.png`);
  await page.screenshot({ path: file });
  console.log('wrote', file);
};

// The foot of the mast, close to, from aft and low, and from above.
{
  const page = await open();
  await scene(page);
  // Twice: the first switch to the free camera blends from the view before.
  await boatCam(page, [0.25, 0.7, -0.1], [0, 0.66, -0.55]);
  await frames(page, 2);
  await boatCam(page, [0.25, 0.7, -0.1], [0, 0.66, -0.55]);
  await frames(page);
  await shot(page, 'mast-foot-low');
  await boatCam(page, [0.2, 1.1, 0.0], [0, 0.65, -0.6]);
  await frames(page);
  await shot(page, 'mast-foot-above');
  await page.close();
}

// Rigging and the crew: the light-air reach (weight on the centreline, the boom eased to starboard), from the helm's
// eye and from outside the cockpit.
{
  const page = await open();
  await scene(page, { heading: 120, tws: 4 });
  await lightReach(page);
  await page.evaluate(() => window.__squib.controller.setCamera('helm'));
  await frames(page, 60);
  await shot(page, 'crew-helm-view');
  await boatCam(page, [2.2, 1.6, 1.6], [0, 0.8, 0.4]);
  await frames(page, 4);
  await shot(page, 'crew-outside');
  await page.close();
}

// Flags: Mosaique's ensign (raked staff) in light air and a breeze, a river boat's ensign, the club's ensign.
for (const [tws, label] of [[3, 'light'], [12, 'breeze']]) {
  const page = await open(800, 600);
  await scene(page, { loc: 'off-rdyc', tws, twd: 270, secs: 2 });
  for (const [name, off, file] of [
    ['mosaique-ensign-cloth', [6, 1, 3], 'flag-mosaique-quarter'],
    ['mosaique-ensign-cloth', [5, 0.5, -0.5], 'flag-mosaique-side'],
    ['ensign-flag', [4, 1, 3], 'flag-river-boat'],
    ['club-ensign-flag', [6, -1, 6], 'flag-club'],
  ]) {
    const ok = await page.evaluate(
      ({ name, off }) => {
        const c = window.__squib.controller;
        if (c.view.mode !== 'free') c.setCamera('free');
        const v = c.view;
        let obj;
        v.scene.traverse((o) => {
          if (!obj && o.name === name) obj = o;
        });
        if (!obj) return false;
        const p = obj.getWorldPosition(new v.camera.position.constructor());
        v.controls.minDistance = 0.01;
        v.controls.target.copy(p);
        v.camera.position.set(p.x + off[0], p.y + off[1], p.z + off[2]);
        v.controls.update();
        return true;
      },
      { name, off },
    );
    if (!ok) {
      console.log('missing', name);
      continue;
    }
    await frames(page);
    await shot(page, `${file}-${label}`);
  }
  await page.close();
}
await browser.close();
