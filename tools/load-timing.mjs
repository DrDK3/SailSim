/**
 * Measure loading the built site over a throttled connection, as a user would see it:
 *   1. "ready": the instruments are live (the app's code is loaded and the simulation runs on open water);
 *   2. "river": the River Dart data has loaded and the river is in the scene;
 * and the bytes transferred. Serve the site first, gzipped like GitHub Pages:
 *   GZIP=1 node tools/pages-server.mjs 4175 squib-dart-sim dist &
 *   node tools/load-timing.mjs [url=http://localhost:4175/squib-dart-sim/] [mbit=10] [runs=3]
 * Times depend on the machine (software WebGL here); compare builds on the same machine. Extra Chromium flags
 * can be passed in CHROMIUM_FLAGS, e.g. "--disable-accelerated-2d-canvas" (docs/PERFORMANCE.md explains why).
 */
import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:4175/squib-dart-sim/';
const mbit = Number(process.argv[3] ?? 10);
const runs = Number(process.argv[4] ?? 3);
const exe = process.env.PW_CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', ...(process.env.CHROMIUM_FLAGS?.split(' ').filter(Boolean) ?? [])] });
const results = [];
for (let i = 0; i < runs; i++) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: (mbit * 1e6) / 8, uploadThroughput: (mbit * 1e6) / 8 });
  const bytes = new Map();
  const urls = new Map();
  cdp.on('Network.responseReceived', (e) => urls.set(e.requestId, e.response.url));
  cdp.on('Network.loadingFinished', (e) => bytes.set(e.requestId, e.encodedDataLength));
  const t0 = Date.now();
  await page.goto(url);
  await page.getByTestId('stw').waitFor();
  await page.waitForFunction(() => (window.__squib?.snapshot().t ?? 0) > 0, null, { polling: 50 });
  const ready = Date.now() - t0;
  await page.waitForFunction(() => window.__squib.controller.getState().dart.status !== 'loading', null, { timeout: 300_000, polling: 50 });
  const river = Date.now() - t0;
  const status = await page.evaluate(() => window.__squib.controller.getState().dart);
  let total = 0;
  const byFile = {};
  for (const [id, n] of bytes) {
    total += n;
    const u = (urls.get(id) ?? '?').replace(/^.*\/squib-dart-sim\//, '');
    byFile[u] = n;
  }
  results.push({ ready, river, total, status: status.status, issues: status.issues.length, byFile });
  await context.close();
}
await browser.close();
const med = (k) => results.map((r) => r[k]).sort((a, b) => a - b)[Math.floor(results.length / 2)];
console.log(`${url} at ${mbit} Mbit/s, ${runs} runs (median): ready ${med('ready')} ms, river ${med('river')} ms, ${(med('total') / 1e6).toFixed(2)} MB transferred; River Dart: ${results[0].status}, ${results[0].issues} issues`);
for (const [f, n] of Object.entries(results[0].byFile).sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${(n / 1024).toFixed(0).padStart(6)} kB  ${f}`);
