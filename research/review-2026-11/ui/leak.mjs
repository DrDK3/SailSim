import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
await page.goto('http://localhost:5173/?nowelcome');
await page.getByTestId('stw').waitFor({ timeout: 120000 });
await page.waitForFunction(() => window.__squib?.controller.getState().dart.status !== 'loading', null, { timeout: 400000 });
const rows = [];
for (let i = 0; i < 6; i++) {
  await page.evaluate((i) => window.__squib.controller.startQuickRace({ competitors: 8, level: 'good', venue: i % 2 ? 'river' : 'start-bay', course: 'windward-leeward', conditions: 'random', wind: 'any', seed: 3 + i, sequence: 'one-minute' }), i);
  await page.waitForTimeout(3500);
  rows.push(await page.evaluate(() => { globalThis.gc?.(); const r = window.__squib.controller.view.renderer.info; return `geo ${r.memory.geometries} tex ${r.memory.textures} heap ${Math.round(performance.memory.usedJSHeapSize / 1e6)}MB`; }));
}
console.log(rows.join('\n'));
await browser.close();
