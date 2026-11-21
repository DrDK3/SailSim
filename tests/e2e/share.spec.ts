import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Package E (review #37–#40): the built index.html's description and sharing tags, the web app manifest and its
 * icons, no service worker (manifest only: docs/NEXT_ROUND_REPORT.md §E), and the static landing page beside the app,
 * whose own address is unchanged. Run against the production build (vite preview), as the site is served.
 */
const CI_SLOW = process.env.CI ? 2 : 1;
const SITE = 'https://drdk3.github.io/SailSim/';

test('the built page: a current description, sharing tags with absolute image URLs, the manifest and its icons, no service worker', async ({ page, request }) => {
  test.setTimeout(120_000 * CI_SLOW);
  await page.goto('/?nowelcome&conditions=set&quality=low');
  await expect(page.getByTestId('stw')).toBeVisible({ timeout: 90_000 * CI_SLOW });
  const meta = (sel: string) => page.locator(sel).first().getAttribute('content');
  const description = await meta('meta[name="description"]');
  expect(description).not.toMatch(/prototype|phase 1/i);
  expect(description).toMatch(/not for navigation/i);
  for (const sel of ['meta[property="og:image"]', 'meta[name="twitter:image"]']) {
    const url = await meta(sel);
    expect(url, sel).toMatch(/^https:\/\//);
    expect(url!.startsWith(SITE), sel).toBe(true);
  }
  expect(await meta('meta[property="og:image:width"]')).toBe('1200');
  expect(await meta('meta[property="og:image:height"]')).toBe('630');
  expect(await meta('meta[name="twitter:card"]')).toBe('summary_large_image');
  expect(await meta('meta[property="og:image:alt"]')).toMatch(/not a photograph/);
  // The card the tags point at is in this build (served at the same path under the site).
  const card = await request.get('social-card.jpg');
  expect(card.status()).toBe(200);
  expect(card.headers()['content-type']).toContain('image/jpeg');
  // The manifest, and every icon it lists.
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const res = await request.get(href!);
  expect(res.status()).toBe(200);
  const manifest = (await res.json()) as { name: string; start_url: string; display: string; icons: { src: string; sizes: string; purpose?: string }[] };
  expect(manifest).toMatchObject({ name: 'Squib Sailing Simulator', start_url: './', display: 'standalone' });
  expect(manifest.icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
  expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
  for (const icon of manifest.icons) expect((await request.get(icon.src)).status(), icon.src).toBe(200);
  // No service worker: the live weather, the club table and the weekly files are always fetched fresh.
  expect(await page.evaluate(async () => ('serviceWorker' in navigator ? (await navigator.serviceWorker.getRegistrations()).length : 0))).toBe(0);
});

test('the landing page: beside the app, which keeps its address; accessible; no sideways scroll on a phone', async ({ page }) => {
  test.setTimeout(120_000 * CI_SLOW);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('landing.html');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Squib Sailing Simulator');
  await expect(page.getByRole('heading', { name: 'How far to trust it' })).toBeVisible();
  await expect(page.locator('main')).toContainText('Not for navigation or performance prediction');
  // Every picture has its text alternative; the video says what it is and has no sound.
  for (const img of await page.locator('img').all()) expect(await img.getAttribute('alt')).not.toBeNull();
  await expect(page.locator('video')).toHaveAttribute('muted', '');
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  // The way in is the app at the site's own address.
  await expect(page.getByRole('link', { name: 'Start sailing' })).toHaveAttribute('href', './');
  // A phone: the buttons are at least 44 px tall and the page does not scroll sideways.
  await page.setViewportSize({ width: 360, height: 740 });
  for (const a of await page.locator('a.cta').all()) expect((await a.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.getByRole('link', { name: 'Start sailing' }).click();
  await expect(page.getByTestId('stw')).toBeVisible({ timeout: 90_000 * CI_SLOW });
  expect(errors).toEqual([]);
});
