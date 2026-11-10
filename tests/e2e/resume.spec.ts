import { expect, test } from '@playwright/test';

/**
 * "Continue where you left off" (src/app/resume.ts): the run is kept in this browser when the page is hidden; on the
 * next visit a card offers it, and Continue sails it again to the same place before handing over.
 */
const CI_SLOW = process.env.CI ? 2 : 1;

test('continue where you left off: kept on leaving, offered next visit, caught up to the same place', async ({ page }) => {
  test.setTimeout(180_000 * CI_SLOW);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?nowelcome&resume&quality=low');
  await expect(page.getByTestId('stw')).toBeVisible();
  await page.waitForFunction(() => window.__squib!.controller.getState().dart.status !== 'loading', null, { timeout: 60_000 * CI_SLOW });
  const left = await page.evaluate(() => {
    const c = window.__squib!.controller;
    c.press('helmRight', true);
    window.__squib!.advance(6);
    c.press('helmRight', false);
    window.__squib!.advance(34);
    window.dispatchEvent(new Event('pagehide'));
    const s = c.sim.snapshot(false);
    return { step: c.sim.step, n: s.n, e: s.e };
  });
  await page.reload();
  const card = page.getByTestId('resume-card');
  await expect(card).toBeVisible({ timeout: 60_000 * CI_SLOW });
  await expect(card).toContainText('Continue where you left off?');
  await expect(card).toContainText(/Free sailing from .* · 40 s in · saved just now/);
  await page.waitForFunction(() => window.__squib!.controller.getState().dart.status !== 'loading', null, { timeout: 60_000 * CI_SLOW });
  await page.getByTestId('resume-continue').click();
  await page.waitForFunction(() => window.__squib!.controller.getState().catchingUp === undefined && !window.__squib!.controller.getState().replay, null, { timeout: 60_000 * CI_SLOW });
  await expect(card).toBeHidden();
  const now = await page.evaluate(() => {
    const c = window.__squib!.controller;
    const s = c.sim.snapshot(false);
    return { step: c.sim.step, n: s.n, e: s.e, paused: c.getState().paused };
  });
  // Handed over at (or, if the frames ran on, just after) where it was left.
  expect(now.step).toBeGreaterThanOrEqual(left.step);
  expect(Math.hypot(now.n - left.n, now.e - left.e)).toBeLessThan(now.step === left.step ? 1e-6 : 10);
  expect(now.paused).toBe(false);
  expect(errors).toEqual([]);
});
