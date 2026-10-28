import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { runDeterminismState } from '../../src/sim/testing/determinism';
import { msToKn, runScenario } from '../../src/sim/index';

/** CI runners draw the scene in software, several times slower (playwright.config.ts). */
const CI_SLOW = process.env.CI ? 2 : 1;

type Snap = { t: number; heading: number; stw: number; rudder: number; mainSide: number };

const snap = (page: Page) => page.evaluate(() => window.__squib!.snapshot() as Snap);

async function open(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await expect(page.getByTestId('stw')).toBeVisible();
  // The River Dart data loads asynchronously and restarts the run when it arrives: wait for it to settle.
  await page.waitForFunction(() => window.__squib!.controller.getState().dart.status !== 'loading', null, { timeout: 60_000 });
  return errors;
}

test('loads, renders a canvas, and the simulation runs without errors', async ({ page }) => {
  const errors = await open(page);
  await expect(page.locator('[data-testid="viewport"] canvas')).toBeVisible();
  const t0 = (await snap(page)).t;
  await expect.poll(async () => (await snap(page)).t, { timeout: 30_000 }).toBeGreaterThan(t0);
  await expect(page.getByText('Starboard tack')).toBeVisible();
  expect(errors).toEqual([]);
});

test('keyboard helm and sheet controls change the boat', async ({ page }) => {
  await open(page);
  const before = await snap(page);
  await page.keyboard.down('KeyD');
  await page.evaluate(() => window.__squib!.advance(2));
  const turning = await snap(page);
  await page.keyboard.up('KeyD');
  expect(turning.rudder).toBeGreaterThan(0.2); // helm to starboard
  const dHeading = Math.atan2(Math.sin(turning.heading - before.heading), Math.cos(turning.heading - before.heading));
  expect(dHeading).toBeGreaterThan(0.05); // bow turned to starboard

  const sheetBefore = await page.evaluate(() => window.__squib!.controller.sim.currentSheet('main'));
  await page.keyboard.down('KeyS');
  await page.evaluate(() => window.__squib!.advance(1));
  await page.keyboard.up('KeyS');
  const input = await page.evaluate(() => window.__squib!.input() as { autoMain: boolean; mainSheet: number });
  expect(input.autoMain).toBe(false);
  expect(input.mainSheet).toBeGreaterThan(sheetBefore);
});

test('on-screen buttons, pause, help and scenario panel work', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: /Steer to port/ }).dispatchEvent('pointerdown');
  await page.evaluate(() => window.__squib!.advance(1));
  expect((await snap(page)).rudder).toBeLessThan(-0.1);
  await page.getByRole('button', { name: /Steer to port/ }).dispatchEvent('pointerup');

  await page.getByTestId('pause').click();
  await expect(page.getByText('Paused (P to resume)')).toBeVisible();
  const tPaused = (await snap(page)).t;
  await page.waitForTimeout(1500);
  expect((await snap(page)).t).toBe(tPaused);
  await page.getByTestId('pause').click();

  await page.keyboard.press('KeyH');
  await expect(page.getByRole('dialog', { name: 'Help' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Help' })).toBeHidden();

  await page.getByRole('button', { name: 'Scenario' }).click();
  const tws = page.locator('.scenario .field', { hasText: 'True wind speed' }).locator('input[type="number"]');
  await tws.fill('15');
  await page.getByRole('button', { name: 'Apply and restart' }).click();
  await expect(page.locator('footer.badge')).toContainText('wind 15 kn');
  expect((await snap(page)).t).toBeLessThan(5);
});

test('criterion 11: reproducible in the browser, and within tolerance of Node', async ({ page }) => {
  await open(page);
  // Same engine: bit-identical.
  const [h1, h2] = await page.evaluate(() => [window.__squib!.determinism(600), window.__squib!.determinism(600)]);
  expect(h1).toBe(h2);
  // Across engines (Node's V8 vs Chromium's V8): Math.sin/cos/pow can differ in the last bit, so compare
  // every state component within 1e-6 (metres, m/s, radians). Measured difference is ~1e-13.
  const node = runDeterminismState(600);
  const browser = await page.evaluate(() => window.__squib!.determinismState(600));
  expect(browser.length).toBe(node.length);
  const maxDiff = Math.max(...node.map((v, i) => Math.abs(v - browser[i]!)));
  console.log(`[criterion 11] max |Node - Chromium| state difference after 600 s: ${maxDiff.toExponential(2)}`);
  expect(maxDiff).toBeLessThan(1e-6);
});

test('without WebGL the app explains the problem and keeps the instruments live', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      if (type.startsWith('webgl')) return null;
      return (orig as (...a: unknown[]) => unknown).call(this, type, ...args);
    } as typeof orig;
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('3D view unavailable');
  const t0 = (await snap(page)).t;
  await expect.poll(async () => (await snap(page)).t, { timeout: 15_000 }).toBeGreaterThan(t0 + 1);
});

test('validation dashboard: eight live charts, table view, CSV export', async ({ page }) => {
  const errors = await open(page);
  await page.evaluate(() => window.__squib!.advance(20));
  await page.keyboard.press('KeyV');
  const dash = page.getByRole('region', { name: 'Validation dashboard' });
  await expect(dash).toBeVisible();
  await expect(dash.locator('.dash-grid figure')).toHaveCount(8);
  // Lines are drawn (each chart has at least one non-empty path).
  const paths = await dash.locator('.dash-grid path').evaluateAll((els) => els.map((e) => (e.getAttribute('d') ?? '').length));
  expect(paths.filter((n) => n > 50).length).toBeGreaterThanOrEqual(8);
  // Crosshair + tooltip on hover.
  const plot = dash.locator('.chart-plot svg').first();
  const box = (await plot.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5, { steps: 3 });
  await expect(dash.locator('.tooltip').first()).toContainText('STW');
  // Table view.
  await dash.getByRole('button', { name: 'Table' }).click();
  await expect(dash.locator('.dash-table tbody tr')).toHaveCount(14);
  // CSV export.
  const [download] = await Promise.all([page.waitForEvent('download'), dash.getByRole('button', { name: 'Export CSV' }).click()]);
  const csv = readFileSync((await download.path())!, 'utf8').split('\n');
  expect(csv[0]).toContain('stw_m_s');
  expect(csv.length).toBeGreaterThan(150);
  await page.keyboard.press('KeyV');
  await expect(dash).toBeHidden();
  expect(errors).toEqual([]);
});

test('scenario panel: replay weather, manual tide and tidal stream appear, labelled, in the instruments', async ({ page }) => {
  const errors = await open(page);
  await page.getByRole('button', { name: 'Scenario' }).click();
  const panel = page.getByRole('region', { name: 'Scenario settings' });
  const source = panel.locator('.field', { hasText: 'Source' }).locator('select');
  // Two bundled replays (22 Oct 07:15 and 23 Oct 14:00 UTC); no live forecast is published here.
  await expect(source.locator('option', { hasText: 'Replay' })).toHaveCount(2);
  await source.selectOption({ label: (await source.locator('option', { hasText: 'Replay' }).first().textContent())! });
  await expect(panel).toContainText('Model output, not a measurement');
  await panel.locator('.field', { hasText: /^Tide/ }).locator('select').selectOption('manual');
  await panel.locator('.field', { hasText: /^Current/ }).locator('select').selectOption('tidal');
  await panel.getByRole('button', { name: 'Apply and restart' }).click();
  await expect(panel).toBeHidden();
  // The conditions are a click away (the instruments start compact).
  await page.getByRole('button', { name: 'All instruments and conditions' }).click();
  const cond = page.getByTestId('conditions');
  await expect(cond).toContainText('Met Office UKV (replay)');
  await expect(page.getByTestId('tide')).toContainText('m CD');
  await expect(cond).toContainText('Tidal stream (modelled)');
  await expect(page.locator('footer.badge')).toContainText('Met Office UKV model wind (replay)');
  expect(errors).toEqual([]);
});

test('polar panel sweeps the model in a worker and matches the Node model', async ({ page }) => {
  test.setTimeout(150_000 * CI_SLOW);
  const errors = await open(page);
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: /Polar sweep/ }).click();
  const polar = page.getByRole('region', { name: 'Model polar' });
  await expect(polar).toContainText('not measured Squib performance');
  await expect(polar.getByRole('status')).toContainText('Computing 10 kn', { timeout: 10_000 });
  await expect(polar.getByRole('status')).toBeHidden({ timeout: 120_000 });
  await polar.getByRole('button', { name: 'Table' }).click();
  const row90 = polar.locator('.dash-table tbody tr', { hasText: /^90°/ });
  const browserKn = Number(await row90.locator('td').nth(1).textContent());
  const nodeKn = msToKn(
    runScenario({ name: 'polar', durationS: 120, conditions: { twsKn: 10, twdDeg: 0 }, initial: { headingDeg: -90, speedKn: 4 }, autopilot: { mode: 'twa', targetDeg: 90 }, optimiseTrim: true }).snapshot().stw,
  );
  expect(Math.abs(browserKn - nodeKn)).toBeLessThan(0.006);
  await page.keyboard.press('Escape');
  await expect(polar).toBeHidden();
  expect(errors).toEqual([]);
});

const dartLoaded = (page: Page) =>
  page.waitForFunction(() => window.__squib!.controller.getState().dart.status !== 'loading', null, { timeout: 60_000 });

test('Phase 3: the River Dart loads, with terrain, minimap and labelled provisional layers', async ({ page }) => {
  const errors = await open(page);
  await dartLoaded(page);
  const state = await page.evaluate(() => {
    const c = window.__squib!.controller;
    const names = new Set<string>();
    (c as unknown as { view: { scene: { traverse: (f: (o: { name: string }) => void) => void } } }).view.scene.traverse((o) => names.add(o.name));
    return { dart: c.getState().dart, names: [...names] };
  });
  expect(state.dart).toEqual({ status: 'loaded', issues: [] });
  for (const n of ['terrain', 'buildings', 'pontoons', 'moorings', 'traffic', 'mark', 'club-ensign', 'berthed-vanes', 'walkers']) expect(state.names).toContain(n);
  await expect(page.getByTestId('minimap')).toBeVisible();
  await expect(page.locator('footer.badge')).toContainText('River Dart (depths and stream provisional)');
  // Depth at the keel is shown, from the provisional depths mid-river.
  await expect(page.locator('.cell', { hasText: 'Depth' })).toContainText('m');
  // Every provisional layer is labelled in the Layers panel.
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: /Layers and sources/ }).click();
  const list = page.getByTestId('provisional-list');
  for (const label of ['Water depth below the low-water line', 'Individual moorings and moored boats', 'Ferries', 'Tidal stream pattern', 'Navigation marks', 'Chart datum offset', 'Official RDYC courses and marks']) {
    await expect(list).toContainText(label);
  }
  await expect(page.getByRole('dialog', { name: 'Map layers and sources' })).toContainText('Contains modified Copernicus Sentinel data 2025');
  await page.keyboard.press('Escape');
  // The channel-following stream is labelled provisional where it is chosen.
  await page.getByRole('button', { name: 'Scenario' }).click();
  const panel = page.getByRole('region', { name: 'Scenario settings' });
  await panel.locator('.field', { hasText: /^Tide/ }).locator('select').selectOption('manual');
  await panel.locator('.field', { hasText: /^Current/ }).locator('select').selectOption('dart');
  await expect(panel).toContainText('Provisional model: follows the channel');
  await panel.getByRole('button', { name: 'Apply and restart' }).click();
  await page.getByRole('button', { name: 'All instruments and conditions' }).click();
  await expect(page.getByTestId('conditions')).toContainText('Tidal stream (modelled, channel-following)');
  expect(errors).toEqual([]);
});

test('Phase 3: sailing at the bank, the boat runs aground in the water and the instruments say so', async ({ page }) => {
  const errors = await open(page);
  await dartLoaded(page);
  // Off RDYC, close-hauled towards the Dartmouth bank about 150 m to the west.
  await page.evaluate(() => {
    const c = window.__squib!.controller;
    c.restart({ ...c.scenario, startLocation: 'off-rdyc', startHeadingDeg: 270 });
    c.advance(120);
  });
  await expect(page.getByTestId('aground')).toBeVisible();
  const s = await page.evaluate(() => {
    const sim = window.__squib!.controller.sim;
    const snap = sim.snapshot(false);
    return { sog: snap.sog, depth: snap.depthAtKeel, bedAboveWater: sim.seabed!.bedElevation(snap.n, snap.e) - snap.waterLevel };
  });
  expect(s.sog).toBeLessThan(0.3);
  expect(s.bedAboveWater).toBeLessThan(0); // the hull centre is still over water
  expect(errors).toEqual([]);
});

for (const [asset, effect] of [['features.json', 'No buildings'], ['drape.jpg', 'plain colours']] as const) {
  test(`Phase 3: a missing ${asset} is reported and the app keeps running`, async ({ page }) => {
    await page.route(`**/geo/${asset}`, (r) => r.fulfill({ status: 404, body: 'not found' }));
    await page.goto('/');
    await expect(page.getByTestId('stw')).toBeVisible();
    await dartLoaded(page);
    await expect(page.getByTestId('dart-warning')).toContainText(asset);
    const st = await page.evaluate(() => window.__squib!.controller.getState().dart);
    expect(st.status).toBe('loaded'); // terrain and depths still work
    expect(st.issues.map((i) => i.asset)).toEqual([asset]);
    await page.getByTestId('dart-warning').getByRole('button', { name: 'Details' }).click();
    await expect(page.getByTestId('load-issues')).toContainText(effect);
    const t0 = (await snap(page)).t;
    await expect.poll(async () => (await snap(page)).t, { timeout: 20_000 }).toBeGreaterThan(t0);
  });
}

test('Phase 3: without the River Dart data the app falls back to open water and says so', async ({ page }) => {
  await page.route('**/geo/manifest.json', (r) => r.abort());
  await page.goto('/');
  await expect(page.getByTestId('stw')).toBeVisible();
  await dartLoaded(page);
  await expect(page.getByTestId('dart-warning')).toContainText('sailing on open water');
  await expect(page.locator('footer.badge')).toContainText('open water');
  const t0 = (await snap(page)).t;
  await expect.poll(async () => (await snap(page)).t, { timeout: 20_000 }).toBeGreaterThan(t0);
});

test('Phase 4: a practice course from the scenario panel: countdown, start signal, and a start when the boat crosses', async ({ page }) => {
  const errors = await open(page);
  await page.getByRole('button', { name: 'Scenario' }).click();
  const panel = page.getByRole('region', { name: 'Scenario settings' });
  const course = panel.getByRole('combobox', { name: 'Course' });
  await expect(course.locator('option[value="club"]')).toHaveAttribute('disabled', '');
  await expect(course.locator('option[value="club"]')).toContainText('none entered yet');
  await course.selectOption('practice:windward-leeward');
  await expect(panel).toContainText('Simulated: not an RDYC course');
  await panel.locator('.field', { hasText: 'Start signal after' }).locator('input[type="number"]').fill('20');
  await panel.getByRole('button', { name: 'Apply and restart' }).click();
  const race = page.getByTestId('race-panel');
  await expect(race).toContainText('Windward–leeward (simulated)');
  await expect(race).toContainText('Simulated course');
  await expect(page.getByTestId('countdown')).toBeVisible();
  const names = await page.evaluate(() => {
    const set = new Set<string>();
    (window.__squib!.controller as unknown as { view: { scene: { traverse: (f: (o: { name: string }) => void) => void } } }).view.scene.traverse((o) => set.add(o.name));
    return [...set];
  });
  expect(names).toContain('course-mark');
  expect(names).toContain('course-line');
  // The boat starts 100 m behind the line, reaching along it. Turn up towards the line, let the helm centre,
  // and sail across after the start signal.
  await page.keyboard.down('KeyD');
  await page.evaluate(() => window.__squib!.advance(1.2));
  await page.keyboard.up('KeyD');
  await page.evaluate(() => window.__squib!.advance(25));
  await expect(race).toContainText('Start signal');
  await page.evaluate(() => {
    for (let i = 0; i < 12 && window.__squib!.controller.getState().race!.phase === 'pre-start'; i++) window.__squib!.advance(10);
  });
  await expect(race).toContainText('Started');
  await expect(page.getByTestId('next-mark')).toContainText('Windward to port');
  expect(errors).toEqual([]);
});

test('Phase 4: course editor: add a mark, live check, import, export', async ({ page }) => {
  const errors = await open(page);
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Course editor' }).click();
  const ed = page.getByRole('dialog', { name: 'Course editor' });
  await expect(ed).toBeVisible();
  // Add a mark by clicking the map.
  const before = await ed.locator('[data-mark]').count();
  await ed.getByRole('button', { name: 'Add mark', exact: true }).click();
  const map = ed.getByTestId('editor-map');
  const box = (await map.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.3);
  await expect(ed.locator('[data-mark]')).toHaveCount(before + 1);
  // Import a course with a mark on land: the check reports it and sailing is refused.
  const bad = {
    schema: 'squib-course/1', id: 'bad', name: 'Bad course', status: 'simulated', provenance: { kind: 'user' },
    marks: [
      { id: 'A', name: 'Pin', kind: 'pin', position: { n: 1380, e: -400 } },
      { id: 'B', name: 'Boat', kind: 'committee-boat', position: { n: 1380, e: -310 } },
      { id: 'C', name: 'Clubhouse', kind: 'inflatable', position: { lat: 50.34801, lon: -3.57339 } },
    ],
    start: { ends: ['A', 'B'] }, legs: [{ type: 'mark', mark: 'C', rounding: 'port' }], laps: 1, finish: { ends: ['A', 'B'] },
  };
  await ed.getByRole('textbox', { name: 'Paste course JSON' }).fill(JSON.stringify(bad));
  await ed.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(ed.getByTestId('editor-issues')).toContainText('Mark Clubhouse is on land');
  await expect(ed.getByRole('button', { name: 'Save and sail' })).toBeDisabled();
  // Load the simulated river course: no problems; export gives the JSON file.
  await ed.getByRole('combobox', { name: 'Load a course' }).selectOption('sim-river-range');
  await expect(ed.getByTestId('editor-issues')).toContainText('No problems found');
  const [download] = await Promise.all([page.waitForEvent('download'), ed.getByRole('button', { name: 'Export JSON' }).click()]);
  const json = JSON.parse(readFileSync((await download.path())!, 'utf8')) as { schema: string; id: string; status: string };
  expect(json).toMatchObject({ schema: 'squib-course/1', id: 'sim-river-range', status: 'simulated' });
  // Sail it.
  await ed.getByRole('button', { name: 'Save and sail' }).click();
  await expect(ed).toBeHidden();
  await expect(page.getByTestId('race-panel')).toContainText('River: the Range sausage (simulated)');
  expect(errors).toEqual([]);
});

test('Phase 5: a race against AI boats: flags, the fleet in 3D and on the map, results', async ({ page }) => {
  test.setTimeout(240_000 * CI_SLOW);
  const errors = await open(page);
  await page.getByRole('button', { name: 'Scenario' }).click();
  const panel = page.getByRole('region', { name: 'Scenario settings' });
  await panel.getByRole('combobox', { name: 'Course' }).selectOption('practice:windward-leeward');
  const num = (label: string) => panel.locator('.field', { hasText: label }).locator('input[type="number"]');
  await num('Leg length').fill('200');
  await num('Laps').fill('1');
  await num('Start signal after').fill('60');
  await num('AI boats').fill('3');
  await panel.getByRole('combobox', { name: 'AI level' }).selectOption('expert');
  await panel.getByRole('button', { name: 'Apply and restart' }).click();
  const race = page.getByTestId('race-panel');
  await expect(race).toContainText('Windward–leeward (simulated)');
  // One-minute sequence: the class flag is up.
  await expect(page.getByTestId('flags')).toContainText('Class');
  // Three AI Squibs in the scene.
  const names = await page.evaluate(() => {
    const set = new Set<string>();
    (window.__squib!.controller as unknown as { view: { scene: { traverse: (f: (o: { name: string }) => void) => void } } }).view.scene.traverse((o) => set.add(o.name));
    return [...set];
  });
  expect(names.filter((n) => n.startsWith('fleet-boat-'))).toHaveLength(3);
  expect(await page.evaluate(() => window.__squib!.controller.getState().fleet.length)).toBe(3);
  // Sail the race out (the user's boat is not sailed), until the committee closes it.
  await page.evaluate(() => {
    for (let i = 0; i < 60 && !window.__squib!.controller.getState().race!.raceOver; i++) window.__squib!.advance(30);
  });
  const results = page.getByTestId('results');
  await expect(results).toBeVisible();
  await expect(results).toContainText('AI01');
  const rows = await results.locator('tbody tr').allInnerTexts();
  expect(rows).toHaveLength(4);
  expect(rows.filter((r) => /\bFIN\b/.test(r))).toHaveLength(3);
  // Your boat was not sailed: it either never started (DNS) or drifted over the line early (OCS); either way
  // it scores entries + 1 = 5 points (low point).
  const you = rows.find((r) => /You/.test(r));
  expect(you).toMatch(/\b(DNS|OCS)\b/);
  expect(you).toMatch(/\b5\b/);
  expect(errors).toEqual([]);
});
