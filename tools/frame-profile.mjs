/**
 * Frame-loop profile (juniors round, Workstream 1 §4.2): drives N frames of the app's own frame loop at a fixed
 * 60 Hz clock, with the DevTools protocol's CPU profiler and sampling heap profiler running, and prints:
 * - the main-thread time per frame (JS in SimController.frame, which includes submitting the drawing),
 * - the JS heap allocated per frame (sampling profiler, bytes per frame by allocating function),
 * - the top functions by self time.
 *
 *   npx vite build && npx vite preview --port 4173 --strictPort &
 *   node tools/frame-profile.mjs out/profile [frames] [cpuThrottle]
 *
 * Software rendering (SwiftShader) here: the GPU's drawing is not in these numbers; the main thread's work is.
 */
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const out = process.argv[2] ?? 'out/profile';
const frames = Number(process.argv[3] ?? 120);
const throttle = Number(process.argv[4] ?? 1);
mkdirSync(out, { recursive: true });
const exe = process.env.PW_CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--js-flags=--expose-gc'] });
const ctx = await browser.newContext({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.addInitScript(() => localStorage.setItem('squib.welcomed.v1', '1'));
await page.goto(`${process.env.BASE ?? 'http://localhost:4173/'}?nowelcome`);
await page.waitForFunction(() => window.__squib?.controller.getState().dart.status === 'loaded', null, { timeout: 600_000 });
// The device check's scenario, sailed a little, the loop stopped so this script drives the frames.
await page.evaluate(() => {
  const c = window.__squib.controller;
  c.setAutoLowerGraphics(false);
  c.restart({ conditions: { startTime: '2026-07-15T12:00:00Z', weather: { source: 'manual', twsKn: 12, twdDeg: 225 }, gusts: { preset: 'moderate', seed: 7 }, current: { mode: 'none' } }, startLocation: 'off-rdyc', startHeadingDeg: 315, startSpeedKn: 4 });
  cancelAnimationFrame(c.raf);
  c.raf = 0;
  let t = performance.now();
  c.lastFrame = t;
  for (let i = 0; i < 30; i++) c.frame((t += 1000 / 60)); // warm up: shaders, first draws
  window.__t = t;
});
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
await cdp.send('HeapProfiler.enable');
await page.evaluate(() => window.gc?.());
await cdp.send('HeapProfiler.startSampling', { samplingInterval: 1024, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
await cdp.send('Profiler.start');
const cpu = await page.evaluate((n) => {
  const c = window.__squib.controller;
  const ms = [];
  let t = window.__t;
  c.press('helmRight', true);
  for (let i = 0; i < n; i++) {
    if (i === n / 2) c.press('helmRight', false);
    const a = performance.now();
    c.frame((t += 1000 / 60));
    ms.push(performance.now() - a);
  }
  return ms;
}, frames);
const { profile } = await cdp.send('Profiler.stop');
const { profile: heap } = await cdp.send('HeapProfiler.stopSampling');
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

// Self time by function.
const self = new Map();
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const dts = profile.timeDeltas;
for (let i = 0; i < profile.samples.length; i++) {
  const n = byId.get(profile.samples[i]);
  const f = n.callFrame;
  const key = `${f.functionName || "(anon)"} ${f.url.split("/").pop().split("?")[0]}:${f.lineNumber + 1}`;
  self.set(key, (self.get(key) ?? 0) + (dts[i] ?? 0) / 1000);
}
const topSelf = [...self.entries()].filter(([k]) => !/^\(idle\)|\(program\)|\(garbage collector\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 25);
const gcMs = [...self.entries()].filter(([k]) => /garbage collector/.test(k)).reduce((a, [, v]) => a + v, 0);

// Allocation by function (sampling: each sample stands for `size` bytes).
const alloc = new Map();
let allocTotal = 0;
const walk = (node) => {
  const bytes = node.selfSize;
  if (bytes) {
    const f = node.callFrame;
    const key = `${f.functionName || "(anon)"} ${f.url.split("/").pop().split("?")[0]}:${f.lineNumber + 1}`;
    alloc.set(key, (alloc.get(key) ?? 0) + bytes);
    allocTotal += bytes;
  }
  for (const c of node.children) walk(c);
};
walk(heap.head);
const topAlloc = [...alloc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
const sorted = [...cpu].sort((a, b) => a - b);
const summary = {
  frames, throttle,
  cpuMs: { median: sorted[Math.floor(frames / 2)], p95: sorted[Math.floor(frames * 0.95)], max: sorted.at(-1) },
  gcMs, gcMsPerFrame: gcMs / frames,
  allocKBPerFrame: allocTotal / 1024 / frames,
  topSelf: topSelf.map(([k, v]) => [k, +(v / frames).toFixed(3)]),
  topAllocKBPerFrame: topAlloc.map(([k, v]) => [k, +(v / 1024 / frames).toFixed(2)]),
};
writeFileSync(`${out}/profile-summary.json`, JSON.stringify(summary, null, 2));
writeFileSync(`${out}/cpu.cpuprofile`, JSON.stringify(profile));
console.log(JSON.stringify(summary, null, 2));
await browser.close();
