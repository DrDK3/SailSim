/**
 * Media for sharing (package E, review #37–#40): deterministic renders of the simulator itself, made headless with
 * the software renderer: a hero image, social cards at 1200 × 630, and a short trailer (H.264, by ffmpeg). Every frame
 * is the simulator's own output at fixed seeds, times and winds, so the same build makes the same pictures; each
 * carries a caption saying so ("simulator output, not a photograph"). No music, no voices, no third-party images or
 * fonts (the caption uses the browser's own sans-serif). Generic figures only: no person, result or record.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   npm run media                      # writes out/media/: hero, social cards, trailer, media.json
 *   node tools/media.mjs out/media [--no-trailer | --trailer-only] [--stills hero,social-card] [--seconds 24] [--fps 24]
 *
 * The trailer needs ffmpeg on the PATH (free software); without it the stills are still made. Under the software
 * renderer a trailer takes tens of minutes (each frame is drawn in software).
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

/** A page at a size, the river loaded, the interface hidden, the frame loop driven by hand, the caption shown. */
async function open(width, height, quality = 'high') {
  const page = await browser.newPage({ viewport: { width, height } });
  // A frame at the high preset takes many seconds under the software renderer.
  page.setDefaultTimeout(600_000);
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto(`${process.env.BASE ?? 'http://localhost:4173/'}?nowelcome&conditions=set&quality=${quality}`);
  await page.waitForFunction(() => window.__squib?.controller.getState().dart.status === 'loaded', null, { timeout: 400_000 });
  await page.addStyleTag({ content: '.app > *:not(.viewport) { visibility: hidden !important; }' });
  await page.evaluate((caption) => {
    const c = window.__squib.controller;
    c.autoLowerGraphics = false;
    c.dynRes.enabled = false;
    c.view.setDynamicScale(1);
    cancelAnimationFrame(c.raf);
    c.raf = 0;
    const cap = document.createElement('div');
    cap.id = 'media-caption';
    cap.textContent = caption;
    cap.style.cssText = 'position:fixed;left:16px;bottom:12px;z-index:99;padding:4px 10px;border-radius:6px;background:rgba(10,20,30,.62);color:#fff;font:600 15px/1.3 system-ui,sans-serif;visibility:visible';
    document.body.appendChild(cap);
  }, CAPTION);
  return page;
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
};

const shots = [];
// The hero image (1600 × 900) and the social cards (1200 × 630, the Open Graph size).
const only = args.includes('--stills') ? args[args.indexOf('--stills') + 1].split(',') : null;
for (const [name, w, h, key] of (flag('trailer-only') ? [] : [
  ['hero', 1600, 900, 'river'],
  ['social-card', 1200, 630, 'river'],
  ['social-evening', 1200, 630, 'evening'],
  ['social-harbour', 1200, 630, 'harbour'],
  ['social-bay', 1200, 630, 'bay'],
]).filter(([name]) => !only || only.includes(name))) {
  const page = await open(w, h);
  await scene(page, SCENES[key]);
  const file = join(out, `${name}.jpg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: 86 });
  shots.push({ file, width: w, height: h, preset: 'high (quality=high)', scene: { name: key, ...SCENES[key] } });
  await page.close();
  console.log('wrote', file);
}

// The trailer: frames at a fixed step through one sail on the river (chase, the harbour from above, chase: a third
// each), then ffmpeg. No sound.
let trailer = null;
if (!flag('no-trailer')) {
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
  }
}

writeFileSync(join(out, flag('trailer-only') ? 'media-trailer.json' : 'media.json'), JSON.stringify({ made: new Date().toISOString(), caption: CAPTION, renderer: 'Chromium software renderer (SwiftShader)', shots, trailer }, null, 2));
await browser.close();
