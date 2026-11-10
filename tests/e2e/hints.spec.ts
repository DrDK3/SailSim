import { expect, test } from '@playwright/test';

/**
 * Hints when you are stuck (src/app/hints.ts; owner, 10 Nov 2026: people "who just want to jump in"): in irons, a hint
 * appears; Show me sails her out of it; it shows once.
 */
const CI_SLOW = process.env.CI ? 2 : 1;

test('in irons: a hint appears, and Show me sails her out of it', async ({ page }) => {
  test.setTimeout(150_000 * CI_SLOW);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?nowelcome&hints&quality=low');
  await expect(page.getByTestId('stw')).toBeVisible();
  await page.waitForFunction(() => window.__squib!.controller.getState().dart.status !== 'loading', null, { timeout: 60_000 * CI_SLOW });
  // Head-to-wind and stopped, in open water off the club.
  await page.evaluate(() => {
    const c = window.__squib!.controller;
    const s = c.scenario;
    c.restart({ ...s, startLocation: 'off-rdyc', startHeadingDeg: 225, startSpeedKn: 0, conditions: { ...s.conditions, weather: { source: 'manual', twsKn: 10, twdDeg: 225 }, gusts: { preset: 'steady', seed: 1 } } });
    window.__squib!.advance(7);
  });
  const card = page.getByTestId('hint-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('In irons');
  await card.getByTestId('hint-show-me').click();
  await expect(card).toBeHidden();
  // With no way on she turns slowly (about 3°/s); out of irons (TWA over 35°) within the 12 s.
  await page.evaluate(() => window.__squib!.advance(12));
  const twa = await page.evaluate(() => Math.abs((window.__squib!.controller as unknown as { sim: { snapshot: (d: boolean) => { twa: number } } }).sim.snapshot(false).twa) * (180 / Math.PI));
  expect(twa).toBeGreaterThan(40);
  // Once only: in irons again, no hint.
  await page.evaluate(() => {
    const c = window.__squib!.controller;
    c.restart({ ...c.scenario });
    window.__squib!.advance(7);
  });
  await expect(card).toBeHidden();
  expect(errors).toEqual([]);
});
