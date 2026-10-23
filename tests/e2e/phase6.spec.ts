import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/** Phase 6 in the browser: the scenario library, replays (save, open, verify, diverge, take over), visual weather. */

async function open(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await expect(page.getByTestId('stw')).toBeVisible();
  await page.waitForFunction(() => window.__squib!.controller.getState().dart.status !== 'loading', null, { timeout: 60_000 });
  return errors;
}

const library = (page: Page) => page.getByRole('region', { name: 'Library' });

test('Phase 6: replays: a raced session saved from the library plays back verified, a changed one diverges', async ({ page }, info) => {
  test.setTimeout(180_000);
  const errors = await open(page);
  await page.getByRole('button', { name: 'Library' }).click();
  await library(page).getByRole('button', { name: 'Load Practice race: windward–leeward, 5 AI boats' }).click();
  await expect(library(page).getByTestId('library-message')).toContainText('Started');
  await expect(page.getByTestId('race-panel')).toContainText('Windward–leeward (simulated)');

  // Pause the real-time loop so the test alone moves the clock; then sail with the keyboard: bear away,
  // trim, head up (inputs sampled step by step).
  await page.getByTestId('pause').click();
  const s0 = await page.evaluate(() => window.__squib!.controller.sim.step);
  await page.keyboard.down('KeyD');
  await page.evaluate(() => window.__squib!.advance(2));
  await page.keyboard.up('KeyD');
  await page.keyboard.down('KeyW');
  await page.evaluate(() => window.__squib!.advance(1.5));
  await page.keyboard.up('KeyW');
  await page.keyboard.down('KeyA');
  await page.evaluate(() => window.__squib!.advance(3));
  await page.keyboard.up('KeyA');
  await page.evaluate(() => window.__squib!.advance(16.5));

  await library(page).getByRole('textbox', { name: 'Replay title' }).fill('E2E race');
  const [download] = await Promise.all([page.waitForEvent('download'), library(page).getByTestId('save-replay').click()]);
  expect(download.suggestedFilename()).toBe('e2e-race.replay.json');
  const file = info.outputPath('race.replay.json');
  await download.saveAs(file);
  const rec = JSON.parse(readFileSync(file, 'utf8')) as { schema: string; endStep: number; inputs: number[][]; checkpoints: [number, string][] };
  expect(rec.schema).toBe('squib-replay/1');
  const end = s0 + 2300;
  expect(rec.endStep).toBe(end);
  // A state hash every 1000 steps, and one where it was saved.
  const marks = [1000, 2000, 3000].filter((x) => x < end).concat(end);
  expect(rec.checkpoints.map((c) => c[0])).toEqual(marks);
  expect(rec.inputs.length).toBeGreaterThan(50);

  // Something else first, then open the replay: the fleet, course and inputs are rebuilt from the file.
  await page.getByRole('button', { name: 'Reset' }).click();
  await page.evaluate(() => window.__squib!.advance(4));
  await library(page).getByLabel('Open replay file').setInputFiles(file);
  const bar = page.getByTestId('replay-bar');
  await expect(bar).toContainText('Replay: E2E race');
  // The sailing controls are replaced while playing back; keys do nothing.
  await expect(page.getByRole('region', { name: 'Sailing controls' })).toHaveCount(0);
  await page.keyboard.down('KeyD');
  await page.evaluate(() => window.__squib!.advance(30)); // past the end: it holds there
  await page.keyboard.up('KeyD');
  const verdict = page.getByTestId('replay-verdict');
  await expect(verdict).toHaveAttribute('data-state', 'ended');
  await expect(verdict).toContainText(`Verified: all ${marks.length} checkpoints matched, bit for bit.`);
  await expect(page.getByText('End of the replay')).toBeVisible();
  const st = await page.evaluate(() => ({ step: window.__squib!.controller.sim.step, hash: window.__squib!.controller.stateHash() }));
  expect(st).toEqual({ step: end, hash: rec.checkpoints.at(-1)![1] });

  // Take over: controls come back and the run continues from the replayed state.
  await bar.getByRole('button', { name: 'Take over' }).click();
  await expect(page.getByRole('region', { name: 'Sailing controls' })).toBeVisible();
  await page.evaluate(() => window.__squib!.advance(1));
  expect(await page.evaluate(() => window.__squib!.controller.sim.step)).toBeGreaterThanOrEqual(end + 100);

  // A changed input row (helm nudged before the first checkpoint) is caught at that checkpoint.
  const i = rec.inputs.findIndex((r) => r[0]! > 100 && r[0]! < 1000);
  rec.inputs[i]![1]! += 0.05;
  await page.getByRole('button', { name: 'Library' }).click(); // the panel closed when the replay opened
  await library(page).getByLabel('Open replay file').setInputFiles({ name: 'changed.replay.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(rec)) });
  await expect(bar).toBeVisible(); // the file is read asynchronously
  await page.evaluate(() => window.__squib!.advance(25));
  await expect(verdict).toHaveAttribute('data-state', 'diverged');
  await expect(verdict).toContainText('Diverged at 10 s');
  expect(errors).toEqual([]);
});

test('Phase 6: scenario library: built-ins, save in the browser, export and import, bad files reported', async ({ page }, info) => {
  const errors = await open(page);
  await page.getByRole('button', { name: 'Library' }).click();
  const lib = library(page);
  // The bundled Met Office replay and the River Dart scenarios are available here.
  for (const name of ['First sail off RDYC', 'Fog in the harbour', 'Wind against tide at the entrance', 'Met Office forecast replay, 23 Oct 2026 14:00 UTC']) {
    await expect(lib.getByRole('button', { name: `Load ${name}` })).toBeEnabled();
  }
  await lib.getByRole('button', { name: 'Load Fog in the harbour' }).click();
  await expect(page.getByTestId('sky')).toContainText(/fog/i);
  await expect(page.locator('footer')).toContainText('fog');

  await lib.getByRole('textbox', { name: 'Scenario title' }).fill('Foggy test');
  await lib.getByRole('button', { name: 'Save current' }).click();
  await expect(lib.getByTestId('library-message')).toContainText('Saved "Foggy test"');
  await expect(lib.getByRole('button', { name: 'Load Foggy test' })).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), lib.getByRole('button', { name: 'Export Foggy test' }).click()]);
  const file = info.outputPath('foggy.scenario.json');
  await download.saveAs(file);
  const exported = JSON.parse(readFileSync(file, 'utf8')) as { schema: string; title: string; scenario: { conditions: { sky: { preset: string } } } };
  expect(exported.schema).toBe('squib-scenario/1');
  expect(exported.scenario.conditions.sky.preset).toBe('fog');

  // Kept across a reload (this browser only), and deletable.
  await page.reload();
  await expect(page.getByTestId('stw')).toBeVisible();
  await page.getByRole('button', { name: 'Library' }).click();
  await expect(lib.getByRole('button', { name: 'Load Foggy test' })).toBeVisible();
  await lib.getByRole('button', { name: 'Delete Foggy test' }).click();
  await expect(lib.getByRole('button', { name: 'Load Foggy test' })).toHaveCount(0);

  // Import the exported file (with a changed wind): it starts.
  const changed = { ...exported, title: 'Imported', scenario: { ...exported.scenario, conditions: { ...exported.scenario.conditions, weather: { source: 'manual', twsKn: 7, twdDeg: 45 } } } };
  await lib.getByLabel('Import scenario file').setInputFiles({ name: 'imported.scenario.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(changed)) });
  await expect(lib.getByTestId('library-message')).toContainText('Imported and started "Imported"');
  expect(await page.evaluate(() => window.__squib!.controller.scenario.conditions.weather)).toEqual({ source: 'manual', twsKn: 7, twdDeg: 45 });
  // Bad files: a reason, and the run carries on.
  await lib.getByLabel('Import scenario file').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"schema":"squib-scenario/1","title":"x","scenario":{}}') });
  await expect(lib.getByTestId('library-message')).toContainText('Not imported: scenario: missing conditions');
  await lib.getByLabel('Open replay file').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('not json') });
  await expect(lib.getByTestId('library-message')).toContainText('Not a replay');
  expect(await page.evaluate(() => window.__squib!.controller.scenario.conditions.weather)).toEqual({ source: 'manual', twsKn: 7, twdDeg: 45 });
  expect(errors).toEqual([]);
});

test('Phase 6: replay speed: at ×8 each frame advances eight times the simulated time', async ({ page }) => {
  const errors = await open(page);
  await page.evaluate(() => {
    const c = window.__squib!.controller;
    c.advance(30);
    c.startReplay(c.saveRecording('speed'));
  });
  const bar = page.getByTestId('replay-bar');
  await bar.getByRole('button', { name: '×8' }).click();
  await expect(bar.getByRole('button', { name: '×8' })).toHaveAttribute('aria-pressed', 'true');
  // Drive two frames 50 ms apart by hand (headless rendering is too slow to time real frames).
  const steps = await page.evaluate(() => {
    const c = window.__squib!.controller as unknown as { frame(now: number): void; sim: { step: number } };
    const now = performance.now() + 1000;
    c.frame(now);
    const s0 = c.sim.step;
    c.frame(now + 50);
    return c.sim.step - s0;
  });
  expect(steps).toBeGreaterThanOrEqual(39); // 0.05 s × 8 = 0.4 s = 40 steps of 0.01 s (± the carried remainder)
  expect(steps).toBeLessThanOrEqual(41);
  await bar.getByRole('button', { name: 'Take over' }).click();
  expect(await page.evaluate(() => window.__squib!.controller.getState().timeScale)).toBe(1);
  expect(errors).toEqual([]);
});
