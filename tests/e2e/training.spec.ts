import { expect, test, type Page } from '@playwright/test';

/**
 * The training slice (docs/TRAINING_SLICE_REPORT.md): the instruments and the settings agree, and the two exercises
 * run end to end. Time is driven with the test hook window.__squib.advance(seconds), not the wall clock, so the
 * tests hold on slow software renderers.
 */

const CI_SLOW = process.env.CI ? 2 : 1;

async function ready(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?nowelcome&quality=low');
  await expect(page.getByTestId('stw')).toBeVisible();
  await page.waitForFunction(() => window.__squib!.controller.getState().dart.status !== 'loading', null, { timeout: 60_000 * CI_SLOW });
  return errors;
}

test('issue 198: after a restart with a Met Office replay, Options shows that source, as the instruments do', async ({ page }) => {
  test.setTimeout(240_000 * CI_SLOW);
  const errors = await ready(page);
  await expect.poll(() => page.evaluate(() => window.__squib!.controller.getState().weatherSources.filter((s) => s.kind === 'replay').length), { timeout: 60_000 * CI_SLOW }).toBeGreaterThan(0);
  const replay = await page.evaluate(() => window.__squib!.controller.getState().weatherSources.find((s) => s.kind === 'replay')!);
  await page.getByRole('button', { name: 'Options', exact: true }).click();
  let panel = page.getByRole('region', { name: 'Options' });
  await panel.locator('.field', { hasText: 'Source' }).locator('select').first().selectOption(replay.id);
  await panel.getByRole('button', { name: 'Apply and restart' }).click();
  await expect.poll(() => page.evaluate(() => window.__squib!.controller.scenario.conditions.weather.source), { timeout: 60_000 * CI_SLOW }).toBe('metoffice');
  // The instruments: the session's conditions come from the Met Office file.
  await expect.poll(() => page.evaluate(() => window.__squib!.controller.getState().envLabel), { timeout: 30_000 * CI_SLOW }).toContain('Met Office');
  // Options, opened again on the new session, shows the same file (it showed "Manual" before the fix).
  await page.getByRole('button', { name: 'Options', exact: true }).click();
  panel = page.getByRole('region', { name: 'Options' });
  await expect(panel.locator('.field', { hasText: 'Source' }).locator('select').first()).toHaveValue(replay.id);
  expect(errors).toEqual([]);
});
