import { expect, test, type Page } from '@playwright/test';

/** CI runners draw the scene in software, several times slower (playwright.config.ts). */
const CI_SLOW = process.env.CI ? 2 : 1;

/**
 * UI v2, slice 1 (docs/UI_V2_REPORT.md): the activity button says what you are doing and opens the experience hub;
 * each of its four doors opens the simulator's existing feature; leaving a race that has started asks first.
 */
async function ready(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/?nowelcome');
  await expect(page.getByTestId('stw')).toBeVisible();
  await page.waitForFunction(() => window.__squib!.controller.getState().dart.status !== 'loading', null, { timeout: 60_000 });
  return errors;
}

const hub = (page: Page) => page.getByRole('dialog', { name: 'Squib sailing simulator' });

test('the activity button opens the hub; each door opens the feature it names, and the button follows', async ({ page }) => {
  test.setTimeout(180_000 * CI_SLOW);
  const errors = await ready(page);
  const chip = page.getByTestId('activity');
  await expect(chip).toContainText('Free sailing');
  await expect(hub(page)).toHaveCount(0);

  // Scenarios: the library.
  await chip.click();
  await expect(hub(page)).toBeVisible();
  await expect(page.getByTestId('hub-now')).toContainText('Free sailing');
  await hub(page).getByRole('button', { name: 'Scenarios' }).click();
  await expect(hub(page)).toBeHidden();
  await expect(page.getByRole('region', { name: 'Library' })).toBeVisible();

  // Race against AI: the race set-up.
  await chip.click();
  await hub(page).getByRole('button', { name: 'Race against AI' }).click();
  await expect(page.getByRole('region', { name: 'Quick race' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Library' })).toHaveCount(0);

  // Learn to sail: the tutorial, and the button says so.
  await chip.click();
  await hub(page).getByRole('button', { name: 'Learn to sail' }).click();
  await expect(page.getByTestId('tutorial')).toBeVisible();
  await expect(chip).toContainText('Tutorial');

  // Free sailing from the lesson: it ends, the boat sails on (no restart).
  const step = await page.evaluate(() => window.__squib!.controller.sim.step);
  await chip.click();
  await hub(page).getByRole('button', { name: 'Free sailing' }).click();
  await expect(page.getByTestId('tutorial')).toHaveCount(0);
  await expect(chip).toContainText('Free sailing');
  expect(await page.evaluate(() => window.__squib!.controller.sim.step)).toBeGreaterThanOrEqual(step);

  // Escape closes the hub without changing anything.
  await chip.click();
  await page.keyboard.press('Escape');
  await expect(hub(page)).toBeHidden();
  expect(errors).toEqual([]);
});

test('leaving a race that has started asks first: keep racing loses nothing; leave starts the new activity', async ({ page }) => {
  test.setTimeout(180_000 * CI_SLOW);
  const errors = await ready(page);
  // A short race: three AI boats, the start signal 10 s in; sail past it.
  await page.evaluate(() => {
    const c = window.__squib!.controller;
    c.restart({ ...c.scenario, startLocation: 'start-bay-practice', course: { source: 'practice', kind: 'windward-leeward' }, race: { sequence: 'one-minute', startInS: 10 }, fleet: { aiCount: 3, level: 'good', prepFlag: 'P' } });
    if (!c.getState().paused) c.togglePause();
    window.__squib!.advance(12);
  });
  const chip = page.getByTestId('activity');
  await expect(chip).toContainText('Race');
  await expect(chip).toContainText('3 AI');

  // From the library, during the race: asked.
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  const lib = page.getByRole('region', { name: 'Library' });
  await lib.getByRole('button', { name: 'Load Fog in the harbour' }).click();
  const ask = page.getByTestId('confirm-leave');
  await expect(ask).toBeVisible();
  await expect(ask).toContainText('Leave the race?');
  await expect(ask).toContainText('Loading “Fog in the harbour” ends it');
  const step = await page.evaluate(() => window.__squib!.controller.sim.step);
  await expect(ask.getByRole('button', { name: 'Keep racing' })).toBeFocused();
  await ask.getByRole('button', { name: 'Keep racing' }).click();
  await expect(ask).toBeHidden();
  await expect(page.getByTestId('race-panel')).toBeVisible();
  expect(await page.evaluate(() => window.__squib!.controller.sim.step)).toBe(step);

  // Escape is "keep racing" too; then leave for real.
  await lib.getByRole('button', { name: 'Load Fog in the harbour' }).click();
  await expect(ask).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(ask).toBeHidden();
  await expect(page.getByTestId('race-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await lib.getByRole('button', { name: 'Load Fog in the harbour' }).click();
  await ask.getByRole('button', { name: 'Leave the race' }).click();
  await expect(lib.getByTestId('library-message')).toContainText('Started "Fog in the harbour"');
  await expect(page.getByTestId('race-panel')).toHaveCount(0);
  await expect(chip).toContainText('Free sailing');
  // A session started from the library sails, though the race had been paused.
  expect(await page.evaluate(() => window.__squib!.controller.getState().paused)).toBe(false);
  expect(errors).toEqual([]);
});
