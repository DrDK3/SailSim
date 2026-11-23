import { expect, test, type Page } from '@playwright/test';

/**
 * Design handover of 23 Nov 2026 (docs/HANDOVER_23NOV_REPORT.md), in the browser.
 */
const CI_SLOW = process.env.CI ? 2 : 1;

async function ready(page: Page, url = '/?nowelcome&conditions=set&quality=low') {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await expect(page.getByTestId('stw')).toBeVisible({ timeout: 90_000 * CI_SLOW });
  await page.waitForFunction(() => window.__squib!.controller.getState().dart.status !== 'loading', null, { timeout: 120_000 * CI_SLOW });
  return errors;
}

/** The controls held now and the single activations under way (controller internals, for the test). */
const heldNow = (page: Page) =>
  page.evaluate(() => {
    const c = window.__squib!.controller as unknown as { held: Set<string>; taps: Map<string, number> };
    return { held: [...c.held].sort(), taps: [...c.taps.keys()].sort() };
  });

test('item 2: a focused steering button works from the keyboard and from a plain click, and lets go', async ({ page }) => {
  test.setTimeout(150_000 * CI_SLOW);
  const errors = await ready(page);
  await page.evaluate(() => {
    const c = window.__squib!.controller;
    if (!c.getState().paused) c.togglePause();
  });
  const btn = page.getByRole('button', { name: /^Steer to port/ });
  await btn.focus();
  // Space held on the focused button: the control is held; released: let go (W3C button pattern).
  await page.keyboard.down('Space');
  expect((await heldNow(page)).held).toEqual(['helmLeft']);
  await page.keyboard.up('Space');
  expect(await heldNow(page)).toEqual({ held: [], taps: [] });
  // Enter the same, and the click the browser makes from it does not act a second time.
  await page.keyboard.down('Enter');
  expect((await heldNow(page)).held).toEqual(['helmLeft']);
  await page.keyboard.up('Enter');
  await page.waitForTimeout(100);
  expect(await heldNow(page)).toEqual({ held: [], taps: [] });
  // A click with no pointer or key behind it (assistive technology): one bounded activation, which lets go as the
  // boat sails on.
  await btn.evaluate((b) => (b as HTMLButtonElement).click());
  expect(await heldNow(page)).toEqual({ held: ['helmLeft'], taps: ['helmLeft'] });
  await page.evaluate(() => window.__squib!.controller.advance(0.5));
  expect(await heldNow(page)).toEqual({ held: [], taps: [] });
  // Losing the focus while the key is down lets go.
  await btn.focus();
  await page.keyboard.down('Space');
  expect((await heldNow(page)).held).toEqual(['helmLeft']);
  await btn.evaluate((b) => (b as HTMLButtonElement).blur());
  expect((await heldNow(page)).held).toEqual([]);
  await page.keyboard.up('Space');
  expect(errors).toEqual([]);
});

test('item 1: during a lesson the device check waits, and says why', async ({ page }) => {
  test.setTimeout(150_000 * CI_SLOW);
  const errors = await ready(page);
  await page.evaluate(() => window.__squib!.controller.startLesson('steer'));
  await page.evaluate(() => window.__squib!.controller.toggleSettings(true));
  await expect(page.getByTestId('settings-panel')).toBeVisible({ timeout: 30_000 * CI_SLOW });
  const start = page.getByTestId('device-check-start');
  await start.scrollIntoViewIfNeeded();
  await expect(start).toBeDisabled();
  await expect(page.getByTestId('device-check-blocked')).toContainText('a lesson is under way');
  // The lesson is still there.
  expect(await page.evaluate(() => !!window.__squib!.controller.getState().tutorial)).toBe(true);
  expect(errors).toEqual([]);
});
