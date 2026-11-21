/**
 * The app's icons for the web app manifest (package E, review #39): the simulator's own mark (public/icons/*.svg)
 * rendered to PNG at 192 and 512 px, and a maskable 512 px, with Chromium (Playwright). No third-party artwork.
 *   node tools/icons.mjs
 */
import { chromium } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';

const exe = process.env.PW_CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({ executablePath: exe });
for (const [src, size, out] of [
  ['icon.svg', 192, 'icon-192.png'],
  ['icon.svg', 512, 'icon-512.png'],
  ['icon-maskable.svg', 512, 'icon-maskable-512.png'],
]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const svg = readFileSync(new URL(`../public/icons/${src}`, import.meta.url), 'utf8');
  await page.setContent(`<html><body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: new URL(`../public/icons/${out}`, import.meta.url).pathname, omitBackground: true });
  await page.close();
  console.log('wrote public/icons/' + out);
}
await browser.close();
