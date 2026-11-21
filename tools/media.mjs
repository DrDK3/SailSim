/**
 * Media for sharing (package E, review #37–#40): deterministic renders of the simulator itself, made headless with
 * the software renderer: a hero image, social cards at 1200 × 630, and a short trailer (H.264, by ffmpeg). Every frame
 * is the simulator's own output at fixed seeds, times and winds, so the same build makes the same pictures; each
 * carries a caption saying so ("simulator output, not a photograph"). No music, no voices, no third-party images or
 * fonts (the caption uses the browser's own sans-serif). Generic figures only: no person, result or record.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   npm run media                      # writes out/media/: hero, social cards, trailer, poster, media.json
 *   node tools/media.mjs out/media [--no-trailer | --trailer-only] [--stills hero,social-card] [--seconds 24] [--fps 24]
 *   node tools/media.mjs out/media --poster-from public/media/trailer.mp4   # only the trailer's poster, from a trailer
 *
 * The hero and the social card (fixes of 21 Nov 2026, §3.6) show an AI fleet running under spinnaker in Start Bay, at
 * the Balanced graphics preset, drawn at twice the size and scaled down in the browser (smoother edges). The other
 * cards keep the High shadows over the lowest preset. The trailer stays at the lowest preset (in software each frame
 * takes seconds); its poster is a frame of the trailer itself, so it differs from the hero. The trailer needs ffmpeg
 * on the PATH (free software); without it the stills are still made. Future videos go to a GitHub Release, not into
 * the repository (docs/DEPLOYMENT.md).
 */
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const args = process.argv.slice(2);
const out = args.find((a, i) => !a.startsWith('--') && !(i > 0 && ['--seconds', '--fps', '--stills'].includes(args[i - 1]))) ?? 'out/media';
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? Number(args[i + 1]) : d;
};
const SECONDS = opt('seconds', 24);
const FPS = opt('fps', 24);
mkdirSync(out, { recursive: true });

const CAPTION = 'Squib sailing simulator · simulator output, not a photograph';
const exe = process.env.PW_CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

/** The Balanced preset's options, as the Settings panel stores them (src/render/graphics.ts, PRESETS.balanced). */
const BALANCED = { preset: 'balanced', resolutionScale: 1, maxPixelRatio: 1.5, scenery: 'high', shadows: 'standard', water: 'high', reflections: 'low', ambientOcclusion: false, hullFoam: true, spray: true, atmosphere: true, cameraMotion: 0.5 };

/**
 * A page at a size, the river loaded, the interface hidden, the frame loop driven by hand, the caption shown.
 * `scale` draws the page that many times larger (the caption too), for a screenshot scaled back down by `shrink`.
 */
async function open(width, height, quality = 'high', { preset, scale = 1 } = {}) {
  const page = await browser.newPage({ viewport: { width: width * scale, height: height * scale } });
  if (preset === 'balanced') await page.addInitScript((g) => localStorage.setItem('squib.graphics.v1', JSON.stringify(g)), BALANCED);
  // A frame at the high preset takes many seconds under the software renderer.
  page.setDefaultTimeout(600_000);
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto(`${process.env.BASE ?? 'http://localhost:4173/'}?nowelcome&conditions=set&quality=${quality}`);
  await page.waitForFunction(() => window.__squib?.controller.getState().dart.status === 'loaded', null, { timeout: 400_000 });
  await page.addStyleTag({ content: '.app > *:not(.viewport) { visibility: hidden !important; }' });
  await page.evaluate(({ caption, scale }) => {
    const c = window.__squib.controller;
    c.autoLowerGraphics = false;
    c.dynRes.enabled = false;
    c.view.setDynamicScale(1);
    cancelAnimationFrame(c.raf);
    c.raf = 0;
    const cap = document.createElement('div');
    cap.id = 'media-caption';
    cap.textContent = caption;
    cap.style.cssText = `position:fixed;left:${16 * scale}px;bottom:${12 * scale}px;z-index:99;padding:${4 * scale}px ${10 * scale}px;border-radius:${6 * scale}px;background:rgba(10,20,30,.62);color:#fff;font:600 ${15 * scale}px/1.3 system-ui,sans-serif;visibility:visible`;
    document.body.appendChild(cap);
  }, { caption: CAPTION, scale });
  return page;
}

/** A screenshot drawn at `scale` times the size, scaled down to width × height in a blank page (high-quality smoothing). */
async function shrink(page, file, width, height) {
  const png = await page.screenshot({ type: 'png' });
  const blank = await browser.newPage();
  const jpeg = await blank.evaluate(
    async ({ b64, w, h }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      const g = cv.getContext('2d');
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, w, h);
      return cv.toDataURL('image/jpeg', 0.86).split(',')[1];
    },
    { b64: png.toString('base64'), w: width, h: height },
  );
  await blank.close();
  writeFileSync(file, Buffer.from(jpeg, 'base64'));
}

/**
 * A fleet running under spinnaker (fixes of 21 Nov 2026, §3.6): a quick race on the short course in Start Bay, the
 * player left at the start; when most of the AI fleet has rounded the windward mark and set its spinnakers, a fixed
 * camera on their quarter. Fixed seed, wind and time, so the same build makes the same picture.
 */
async function fleetScene(page, s) {
  return page.evaluate((s) => {
    const c = window.__squib.controller;
    if (c.paused) c.togglePause();
    c.restart({
      ...c.scenario,
      course: undefined,
      race: undefined,
      fleet: undefined,
      startLocation: 'start-bay-practice',
      conditions: { ...c.scenario.conditions, startTime: s.time, weather: { source: 'manual', twsKn: s.tws, twdDeg: s.twd }, gusts: { preset: 'steady', seed: 1 }, current: { mode: 'none' } },
    });
    c.startQuickRace({ competitors: s.boats, level: 'good', venue: 'start-bay', course: 'short', conditions: 'as-set', wind: 'any', seed: s.seed, sequence: 'one-minute', spinnaker: true });
    const ai = () => c.race.session.fleet.boats.filter((b) => b.kind === 'ai');
    const flying = () => ai().filter((b) => b.sim.spin?.phase === 'up' && b.sim.spin.fill > 0.8);
    let t = 0;
    while (flying().length < s.flying && t < 900) {
      c.advance(5);
      t += 5;
    }
    c.advance(s.settle);
    const set = flying();
    // The middle of the boats under spinnaker, their mean heading, and a camera on their quarter.
    const n = set.reduce((a, b) => a + b.sim.state.n, 0) / set.length;
    const e = set.reduce((a, b) => a + b.sim.state.e, 0) / set.length;
    const hx = set.reduce((a, b) => a + Math.sin(b.sim.state.psi), 0);
    const hy = set.reduce((a, b) => a + Math.cos(b.sim.state.psi), 0);
    const psi = Math.atan2(hx, hy);
    const f = { e: Math.sin(psi), n: Math.cos(psi) };
    const side = { e: Math.cos(psi), n: -Math.sin(psi) };
    c.setCamera('free');
    const v = c.view;
    // The marks' name labels are interface, hidden like the rest of it (the marks themselves still drawn).
    const course = v.course;
    if (course) {
      const update = course.update.bind(course);
      course.update = (leg, phase, _labels, ...rest) => update(leg, phase, false, ...rest);
    }
    // Scene axes: x east, y up, z south.
    const camE = e - f.e * s.back + side.e * s.side;
    const camN = n - f.n * s.back + side.n * s.side;
    v.camera.position.set(camE, s.up, -camN);
    v.controls.target.set(e + f.e * s.ahead, 3, -(n + f.n * s.ahead));
    v.controls.update();
    let tt = performance.now();
    for (let i = 0; i < 40; i++) c.frame((tt += 50));
    if (!c.paused) c.togglePause();
    for (let i = 0; i < 4; i++) c.frame((tt += 50));
    return { raceS: t + s.settle, underSpinnaker: set.length, boats: c.race.session.fleet.boats.length };
  }, s);
}

/** Sail a fixed scene (place, time, wind, seconds, camera), then draw a few frames so the wake and the sea form. */
async function scene(page, s) {
  await page.evaluate((s) => {
    const c = window.__squib.controller;
    if (c.paused) c.togglePause();
    c.restart({
      ...c.scenario,
      course: undefined,
      race: undefined,
      fleet: undefined,
      startLocation: s.loc,
      startHeadingDeg: s.heading ?? c.scenario.startHeadingDeg,
      conditions: { ...c.scenario.conditions, startTime: s.time, weather: { source: 'manual', twsKn: s.tws, twdDeg: s.twd }, gusts: { preset: 'steady', seed: 1 } },
    });
    c.advance(s.secs);
    c.setCamera(s.camera);
    let t = performance.now();
    for (let i = 0; i < 40; i++) {
      t += 50;
      c.frame(t);
    }
    if (!c.paused) c.togglePause();
  }, s);
}

const SCENES = {
  river: { loc: 'off-rdyc', time: '2026-07-15T11:00:00Z', tws: 12, twd: 225, secs: 25, camera: 'chase' },
  evening: { loc: 'off-rdyc', time: '2026-07-15T18:30:00Z', tws: 10, twd: 250, secs: 30, camera: 'chase' },
  harbour: { loc: 'off-rdyc', time: '2026-07-15T11:00:00Z', tws: 12, twd: 225, secs: 25, camera: 'drone' },
  bay: { loc: 'start-bay-practice', time: '2026-07-15T13:00:00Z', tws: 14, twd: 225, secs: 40, camera: 'chase' },
  fleet: { kind: 'fleet', time: '2026-07-15T12:00:00Z', tws: 11, twd: 225, boats: 6, seed: 21, flying: 4, settle: 12, back: 34, side: 16, up: 6, ahead: 10 },
};

const shots = [];
// The hero image (1600 × 900) and the social cards (1200 × 630, the Open Graph size).
const only = args.includes('--stills') ? args[args.indexOf('--stills') + 1].split(',') : null;
const posterFrom = args.includes('--poster-from') ? args[args.indexOf('--poster-from') + 1] : null;
for (const [name, w, h, key] of (flag('trailer-only') || posterFrom ? [] : [
  ['hero', 1600, 900, 'fleet'],
  ['social-card', 1200, 630, 'fleet'],
  ['social-river', 1200, 630, 'river'],
  ['social-evening', 1200, 630, 'evening'],
  ['social-harbour', 1200, 630, 'harbour'],
  ['social-bay', 1200, 630, 'bay'],
]).filter(([name]) => !only || only.includes(name))) {
  const file = join(out, `${name}.jpg`);
  if (SCENES[key].kind === 'fleet') {
    const page = await open(w, h, 'high', { preset: 'balanced', scale: 2 });
    const got = await fleetScene(page, SCENES[key]);
    await shrink(page, file, w, h);
    shots.push({ file, width: w, height: h, preset: 'Balanced, drawn at 2× and scaled down', scene: { name: key, ...SCENES[key], ...got } });
    await page.close();
  } else {
    const page = await open(w, h);
    await scene(page, SCENES[key]);
    await page.screenshot({ path: file, type: 'jpeg', quality: 86 });
    shots.push({ file, width: w, height: h, preset: 'high (quality=high)', scene: { name: key, ...SCENES[key] } });
    await page.close();
  }
  console.log('wrote', file);
}

/** The trailer's poster: its frame at 2 s (so it shows what the video shows, and differs from the hero). */
function poster(trailerFile) {
  const file = join(out, 'poster.jpg');
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '2', '-i', trailerFile, '-frames:v', '1', '-q:v', '3', file], { stdio: 'inherit' });
  if (r.status === 0) {
    shots.push({ file, width: 960, height: 540, preset: 'the trailer’s frame at 2 s', scene: { name: 'trailer poster' } });
    console.log('wrote', file);
  } else console.log('ffmpeg failed: no poster');
}
if (posterFrom) poster(posterFrom);

// The trailer: frames at a fixed step through one sail on the river (chase, the harbour from above, chase: a third
// each), then ffmpeg. No sound.
let trailer = null;
if (!flag('no-trailer') && !posterFrom) {
  if (spawnSync('ffmpeg', ['-version']).status !== 0) console.log('ffmpeg not found: no trailer');
  else {
    const frames = join(out, 'frames');
    rmSync(frames, { recursive: true, force: true });
    mkdirSync(frames, { recursive: true });
    // The lowest preset for the trailer: each of its frames is drawn in software, and the high preset would take hours.
    const page = await open(960, 540, 'low');
    await scene(page, SCENES.river);
    const n = SECONDS * FPS;
    for (let i = 0; i < n; i++) {
      if (i === Math.round(SECONDS / 3) * FPS) await page.evaluate(() => window.__squib.controller.setCamera('drone'));
      if (i === Math.round((2 * SECONDS) / 3) * FPS) await page.evaluate(() => window.__squib.controller.setCamera('chase'));
      await page.evaluate((dt) => {
        const c = window.__squib.controller;
        c.advance(dt);
        c.frame(performance.now());
      }, 1 / FPS);
      await page.screenshot({ path: join(frames, `f${String(i).padStart(5, '0')}.png`) });
      if (i % FPS === 0) console.log(`trailer ${i / FPS} of ${SECONDS} s`);
    }
    await page.close();
    const file = join(out, 'trailer.mp4');
    const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(frames, 'f%05d.png'), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', file], { stdio: 'inherit' });
    if (r.status === 0) trailer = { file, seconds: SECONDS, fps: FPS, size: '960x540', preset: 'lowest (quality=low)', codec: 'H.264 (libx264, -preset veryfast, CRF 24)', audio: 'none' };
    rmSync(frames, { recursive: true, force: true });
    console.log(trailer ? `wrote ${file}` : 'ffmpeg failed: no trailer');
    if (trailer) poster(file);
  }
}

writeFileSync(join(out, flag('trailer-only') ? 'media-trailer.json' : 'media.json'), JSON.stringify({ made: new Date().toISOString(), caption: CAPTION, renderer: 'Chromium software renderer (SwiftShader)', shots, trailer }, null, 2));
await browser.close();
