/**
 * Screenshots for the fixes of 21 Nov 2026 (docs/FIXES_21NOV_REPORT.md §4): a phone upright at 360, 390 and 430 px
 * at the Learn level (the sails' state pills in full, the controls, the view), the teaching overlay's VMG beside the
 * instruments' (the same figure, §2.4), and the Learn wind words (§2.4). Fixed scene, wind and seed. Software
 * rendering (SwiftShader) only, as everywhere in this repository's screenshots.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node tools/fixes21-shots.mjs docs/img/fixes-21nov
 */
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'out/fixes21-shots';
mkdirSync(out, { recursive: true });
const BASE = process.env.BASE ?? 'http://localhost:4173/';
const exe = process.env.PW_CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

/** The app loaded, the river data in, a broad reach in 10 kn from 225° (heading 100°), sailed 15 s, then paused. */
async function open(context, level) {
  const page = await context.newPage();
  page.setDefaultTimeout(600_000);
  await page.goto(`${BASE}?nowelcome&conditions=set&quality=low`);
  await page.waitForFunction(() => window.__squib?.controller.getState().dart.status !== 'loading', null, { timeout: 400_000 });
  await page.evaluate((level) => {
    const c = window.__squib.controller;
    c.setLevel(level);
    const s = structuredClone(c.scenario);
    c.restart({ ...s, startLocation: 'start-bay-practice', startHeadingDeg: 100, startSpeedKn: 4, conditions: { ...s.conditions, startTime: '2026-07-15T11:00:00Z', weather: { source: 'manual', twsKn: 10, twdDeg: 225 }, gusts: { preset: 'steady', seed: 1 }, current: { mode: 'none' } } });
    c.advance(15);
    if (!c.getState().paused) c.togglePause();
  }, level);
  // A moment for the interface to show the new state.
  await page.waitForTimeout(1500);
  return page;
}

// A phone upright, at the Learn level.
for (const [w, h] of [[360, 740], [390, 844], [430, 932]]) {
  const context = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await open(context, 'learn');
  const file = join(out, `phone-${w}-learn.jpg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: 82 });
  console.log('wrote', file);
  await context.close();
}

// The teaching overlay's VMG and the instruments', and the Learn wind words, on a desktop.
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await open(context, 'learn');
  await page.evaluate(() => {
    const c = window.__squib.controller;
    c.toggleTeaching(true);
    c.setCamera('chase');
    let t = performance.now();
    for (let i = 0; i < 4; i++) c.frame((t += 50));
  });
  await page.waitForTimeout(1500);
  let file = join(out, 'overlay-vmg-learn.jpg');
  await page.screenshot({ path: file, type: 'jpeg', quality: 84 });
  console.log('wrote', file);
  file = join(out, 'learn-wind-words.png');
  await page.locator('.panel.instruments').screenshot({ path: file });
  console.log('wrote', file);
  await page.evaluate(() => window.__squib.controller.setLevel('club'));
  await page.waitForTimeout(1500);
  file = join(out, 'club-wind-twa.png');
  await page.locator('.panel.instruments').screenshot({ path: file });
  console.log('wrote', file);
  await context.close();
}
await browser.close();
