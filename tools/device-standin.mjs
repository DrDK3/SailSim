/**
 * Local stand-ins for juniors' devices (juniors round, Workstream 1). NOT real devices: Chromium on this machine
 * with the CPU slowed by the DevTools protocol (Emulation.setCPUThrottlingRate) and a small screen at pixel ratio 1.
 * Each stand-in loads the page afresh (so start-up is measured under the throttle) and runs the in-app device check
 * (src/app/deviceCheck.ts), then saves its JSON report.
 *
 *   npx vite build && npx vite preview --port 4173 --strictPort &
 *   node tools/device-standin.mjs out/standin [seconds] [names]
 *
 * Environment: BASE (default http://localhost:4173/), AUTO=0 to switch automatic quality off (like-for-like
 * comparisons), GPU=1 for the machine's graphics card. The preset is the app's default for the renderer (Smooth, the
 * lowest, on a software renderer).
 *
 * Without a GPU the drawing is done by SwiftShader on the CPU, so the CPU throttle slows the drawing too: these
 * numbers are far worse than a device with any graphics hardware, and say nothing about a particular real device.
 */
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';

const out = process.argv[2] ?? 'out/standin';
const seconds = Number(process.argv[3] ?? 50);
const only = process.argv[4] ? process.argv[4].split(',') : null;
mkdirSync(out, { recursive: true });

const STANDINS = [
  { name: 'laptop-x1', cpu: 1, w: 1366, h: 768 },
  { name: 'laptop-x4', cpu: 4, w: 1366, h: 768 },
  { name: 'chromebook-x6', cpu: 6, w: 1366, h: 768 },
  { name: 'tablet-x4', cpu: 4, w: 1024, h: 768, touch: true },
  { name: 'phone-x6', cpu: 6, w: 390, h: 844, touch: true },
];

const gpu = process.env.GPU === '1';
const exe = process.env.PW_CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const machine = { cpu: os.cpus()[0]?.model, cores: os.cpus().length, memGb: Math.round(os.totalmem() / 2 ** 30), platform: `${os.platform()} ${os.release()}`, renderer: gpu ? 'GPU' : 'SwiftShader (software)' };
const results = [];
for (const s of STANDINS) {
  if (only && !only.includes(s.name)) continue;
  const browser = await chromium.launch({ executablePath: exe, headless: !gpu, args: gpu ? ['--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 1, hasTouch: !!s.touch });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.addInitScript(() => localStorage.setItem('squib.welcomed.v1', '1'));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: s.cpu });
  const t0 = Date.now();
  await page.goto(`${process.env.BASE ?? 'http://localhost:4173/'}?nowelcome`);
  await page.waitForFunction(() => window.__squib?.controller.getState().dart.status !== 'loading', null, { timeout: 900_000 });
  const loadS = (Date.now() - t0) / 1000;
  if (process.env.AUTO === '0') await page.evaluate(() => window.__squib.controller.setAutoLowerGraphics(false));
  await page.evaluate((secs) => window.__squib.controller.startDeviceCheck(secs), seconds);
  await page.waitForFunction(() => !!window.__squib.controller.lastDeviceReport, null, { timeout: (seconds + 600) * 1000, polling: 1000 });
  const report = await page.evaluate(() => window.__squib.controller.lastDeviceReport);
  const row = { standin: s, wallLoadS: loadS, report };
  writeFileSync(`${out}/${s.name}.json`, JSON.stringify(row, null, 2));
  const f = report.frames;
  console.log(`${s.name}: ${report.verdict.label} · cpu median ${report.cpu?.medianMs} p95 ${report.cpu?.p95Ms} max ${report.cpu?.longestMs} · frame median ${f.medianMs} ms, p95 ${f.p95Ms}, p99 ${f.p99Ms}, longest ${f.longestMs}, ${f.over33}/${f.frames} over 33 ms · first frame ${report.startup.firstFrameMs} ms, sailable ${report.startup.sailableMs} ms, stalls ${report.startup.stalls.length} · input ${report.input.medianMs} ms · ${report.graphics.presetAtStart}→${report.graphics.presetAtEnd} ${report.graphics.resolutionAtEnd}`);
  results.push(row);
  await browser.close();
}
writeFileSync(`${out}/summary.json`, JSON.stringify({ note: 'Stand-ins on one machine, not real devices', machine, auto: process.env.AUTO ?? '1', seconds, results }, null, 2));
