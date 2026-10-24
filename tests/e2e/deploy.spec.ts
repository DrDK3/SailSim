import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * Phase 6 acceptance on the production build served like GitHub Pages: under a sub-path
 * (http://localhost:4174/squib-dart-sim/, tools/pages-server.mjs), with no fallback routing.
 * Every asset the app fetches must resolve relative to the page, and missing or stale data must be handled.
 */

type Snap = { t: number; stw: number };
const snap = (page: Page) => page.evaluate(() => window.__squib!.snapshot() as Snap);

async function open(page: Page): Promise<{ errors: string[]; requests: string[] }> {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('request', (r) => requests.push(r.url()));
  await page.goto('./');
  await expect(page.getByTestId('stw')).toBeVisible();
  await page.waitForFunction(() => window.__squib!.controller.getState().dart.status !== 'loading', null, { timeout: 60_000 });
  return { errors, requests };
}

test('the production build runs under a sub-path: assets, River Dart data, physics, controls', async ({ page, baseURL }) => {
  const { errors, requests } = await open(page);
  expect(page.url()).toBe(baseURL);
  await expect(page.locator('[data-testid="viewport"] canvas')).toBeVisible();
  expect(await page.evaluate(() => window.__squib!.controller.getState().dart.status)).toBe('loaded');
  // Every request stays inside the site's sub-path (nothing assumes the site is at the server root).
  const local = requests.filter((u) => u.startsWith('http://localhost:4174/'));
  expect(local.length).toBeGreaterThan(5);
  expect(local.filter((u) => !u.startsWith(baseURL!))).toEqual([]);
  // The simulation runs and the controls act on it.
  const t0 = (await snap(page)).t;
  await expect.poll(async () => (await snap(page)).t, { timeout: 20_000 }).toBeGreaterThan(t0);
  const before = await page.evaluate(() => (window.__squib!.snapshot() as { rudder: number }).rudder);
  await page.keyboard.down('KeyD');
  await page.evaluate(() => window.__squib!.advance(0.5));
  const held = await page.evaluate(() => (window.__squib!.snapshot() as { rudder: number }).rudder);
  await page.keyboard.up('KeyD');
  expect(held).toBeGreaterThan(before + 0.05); // helm to starboard
  expect(errors).toEqual([]);
});

test('the polar worker loads from the sub-path', async ({ page }) => {
  test.setTimeout(150_000);
  const { errors } = await open(page);
  await page.getByRole('button', { name: /^Tools/ }).click();
  await page.getByRole('menuitemcheckbox', { name: /Polar sweep/ }).click();
  const polar = page.getByRole('region', { name: 'Model polar' });
  await expect(polar.getByRole('status')).toContainText('Computing', { timeout: 10_000 });
  await expect(polar.getByRole('status')).toBeHidden({ timeout: 120_000 });
  expect(errors).toEqual([]);
});

test('a direct link to a file that does not exist gets a 404, not the app (no fallback routing)', async ({ page, baseURL }) => {
  const res = await page.goto(new URL('no-such-page', baseURL).href);
  expect(res?.status()).toBe(404);
});

// ---------------------------------------------------------------- live data: present, stale, missing, corrupt

const REPLAY_V2 = 'metoffice-replay-2026-10-23T1400Z.json';
const BUNDLED = [
  { path: REPLAY_V2, kind: 'weather', mode: 'replay' },
  { path: 'metoffice-replay-2026-10-22T0715Z.json', kind: 'weather', mode: 'replay' },
];

/** Shift every ISO time in a JSON document by `deltaMs` (to make a recorded file current, stale or old). */
function shiftTimes(doc: unknown, deltaMs: number): unknown {
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?Z$/;
  const fmt = (s: string) => {
    const d = new Date(Date.parse(s) + deltaMs).toISOString();
    return s.length === 17 ? `${d.slice(0, 16)}Z` : `${d.slice(0, 19)}Z`;
  };
  if (typeof doc === 'string') return iso.test(doc) ? fmt(doc) : doc;
  if (Array.isArray(doc)) return doc.map((x) => shiftTimes(x, deltaMs));
  if (doc && typeof doc === 'object') return Object.fromEntries(Object.entries(doc).map(([k, v]) => [k, shiftTimes(v, deltaMs)]));
  return doc;
}

/** A live forecast made from the bundled two-hour replay: its first step `startsMinAgo`, the job ran `jobMinAgo`. */
async function liveForecast(page: Page, baseURL: string, startsMinAgo: number, jobMinAgo: number): Promise<unknown> {
  const rec = (await (await page.request.get(new URL(`live/${REPLAY_V2}`, baseURL).href)).json()) as { model: { steps: { valid: string }[] }; generated: string };
  const delta = Date.now() - startsMinAgo * 60000 - Date.parse(rec.model.steps[0]!.valid);
  const doc = shiftTimes(rec, delta) as { generated: string };
  doc.generated = new Date(Date.now() - jobMinAgo * 60000).toISOString().slice(0, 19) + 'Z';
  return doc;
}

async function serveLive(page: Page, files: Record<string, unknown>, index: 'list' | 'missing' = 'list'): Promise<void> {
  await page.route('**/live/index.json', (r) =>
    index === 'missing'
      ? r.fulfill({ status: 404, body: 'not found' })
      : r.fulfill({
          json: {
            schema: 'squib-live-index/1',
            files: [
              ...Object.keys(files).map((p) => ({ path: p, kind: p.startsWith('tide') ? 'tide' : 'weather', mode: 'live' })),
              ...BUNDLED,
            ],
          },
        }),
  );
  for (const [name, body] of Object.entries(files)) {
    await page.route(`**/live/${name}`, (r) => (typeof body === 'string' ? r.fulfill({ body, contentType: 'application/json' }) : r.fulfill({ json: body })));
  }
}

type LiveUi = { weatherSources: { kind: string; label: string; freshness?: { status: string } }[]; tideSources: { label: string }[]; liveIssues: string[] };
const liveUi = (page: Page) => page.evaluate(() => window.__squib!.controller.getState() as unknown as LiveUi);

async function openScenario(page: Page) {
  await page.getByRole('button', { name: 'Scenario' }).click();
  return page.getByRole('region', { name: 'Scenario settings' });
}

test('live data: a current forecast is offered as live; choosing it follows the forecast and its sky', async ({ page, baseURL }) => {
  await serveLive(page, { 'latest.json': await liveForecast(page, baseURL!, 10, 5) });
  const { errors } = await open(page);
  await expect.poll(async () => (await liveUi(page)).weatherSources.length).toBe(3);
  const ui = await liveUi(page);
  expect(ui.weatherSources[0]).toMatchObject({ kind: 'live', freshness: { status: 'fresh' } });
  expect(ui.liveIssues).toEqual([]);
  const panel = await openScenario(page);
  await panel.locator('.field', { hasText: 'Source' }).locator('select').selectOption({ label: ui.weatherSources[0]!.label });
  await expect(panel.getByTestId('weather-freshness')).toContainText('Forecast covers now');
  await expect(panel.getByRole('combobox', { name: 'Sky' })).toHaveValue('data');
  await panel.getByRole('button', { name: 'Apply and restart' }).click();
  await expect(page.locator('footer.badge')).toContainText('Met Office UKV');
  const sky = await page.evaluate(() => (window.__squib!.controller.sim.env.describe?.(0, 0, 0) as { sky?: { kind: string } }).sky);
  expect(sky?.kind).toBe('model');
  expect(errors).toEqual([]);
});

test('live data: a forecast that has run out is stale (warned), a day-old one only a recording', async ({ page, baseURL }) => {
  // Ended 60 min ago (stale); and a separate file from yesterday (expired).
  await serveLive(page, {
    'latest.json': await liveForecast(page, baseURL!, 180, 175),
    'latest-old.json': await liveForecast(page, baseURL!, 26 * 60, 26 * 60),
  });
  const { errors } = await open(page);
  await expect.poll(async () => (await liveUi(page)).weatherSources.length).toBe(4);
  const ui = await liveUi(page);
  expect(ui.weatherSources[0]).toMatchObject({ kind: 'live', freshness: { status: 'stale' } });
  expect(ui.weatherSources[0]!.label).toContain('stale');
  expect(ui.weatherSources[1]).toMatchObject({ kind: 'replay', freshness: { status: 'expired' } });
  expect(ui.weatherSources[1]!.label).toMatch(/^Recorded/);
  const panel = await openScenario(page);
  await panel.locator('.field', { hasText: 'Source' }).locator('select').selectOption({ label: ui.weatherSources[0]!.label });
  await expect(panel.getByTestId('weather-freshness')).toContainText('Stale: the forecast ended');
  expect(errors).toEqual([]);
});

test('live data: a corrupt file is reported and skipped; a missing index falls back to the bundled replays', async ({ page }) => {
  test.setTimeout(180_000); // two full loads of the app
  await serveLive(page, { 'latest.json': '{"model": {"available": tru' });
  const { errors } = await open(page);
  await expect.poll(async () => (await liveUi(page)).liveIssues.length).toBe(1);
  let ui = await liveUi(page);
  expect(ui.liveIssues[0]).toContain('live/latest.json');
  expect(ui.weatherSources.map((s) => s.kind)).toEqual(['replay', 'replay']);
  const panel = await openScenario(page);
  await expect(panel.getByTestId('live-issues')).toContainText('Not offered');
  await expect(panel.getByTestId('no-live-weather')).toBeVisible();
  expect(errors).toEqual([]);

  const page2 = await page.context().newPage();
  await serveLive(page2, {}, 'missing');
  const r2 = await open(page2);
  await expect.poll(async () => (await liveUi(page2)).weatherSources.length).toBe(2);
  ui = await liveUi(page2);
  expect(ui.liveIssues[0]).toContain('index');
  // The only console message is the browser's own note of the 404 this test serves.
  expect(r2.errors.filter((e) => !e.includes('404'))).toEqual([]);
  await page2.close();
});

test('live data: a live tide file is offered and sets the water level, gauge surge included', async ({ page }) => {
  const example = JSON.parse(readFileSync(new URL('../../tools/ingest/fixtures/tide-snapshot.example.json', import.meta.url), 'utf8')) as { gauge: { readings: { time: string }[] } };
  const last = example.gauge.readings[example.gauge.readings.length - 1]!.time;
  const tide = shiftTimes(example, Date.now() - 10 * 60000 - Date.parse(last)); // last reading 10 min ago
  await serveLive(page, { 'tide.json': tide });
  const { errors } = await open(page);
  await expect.poll(async () => (await liveUi(page)).tideSources.length).toBe(1);
  const panel = await openScenario(page);
  const label = (await liveUi(page)).tideSources[0]!.label;
  await panel.getByRole('button', { name: 'Now' }).click();
  await panel.locator('.field', { hasText: 'Tide' }).first().locator('select').selectOption({ label });
  await expect(panel.getByTestId('tide-freshness')).toContainText('Gauge reading');
  await panel.getByRole('button', { name: 'Apply and restart' }).click();
  const notes = await page.evaluate(() => (window.__squib!.controller.sim.env.describe?.(0, 0, 0) as { tide?: { notes: string[] } }).tide?.notes.join(' '));
  expect(notes).toContain('residual');
  expect(errors).toEqual([]);
});
