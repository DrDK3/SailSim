import { expect, test, type Page } from '@playwright/test';

/**
 * Owner, 18 Nov 2026: "I cannot dismiss the resolution lowered warning". The notice under the toolbar let every
 * click through to the water, its own link included, and stayed for as long as the resolution was lowered. Its link
 * and its "×" now take clicks, it is said once a visit, and it goes by itself after a quarter of a minute.
 */
const CI_SLOW = process.env.CI ? 2 : 1;

type Hooks = { view: { setDynamicScale(f: number): void }; dynRes: { enabled: boolean }; watchPace: () => void; runningSlow: unknown; publish(force?: boolean): void };

async function ready(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?nowelcome&quality=low');
  await expect(page.getByTestId('stw')).toBeVisible();
  await page.waitForFunction(() => window.__squib!.controller.getState().dart.status !== 'loading', null, { timeout: 60_000 * CI_SLOW });
  return errors;
}

/** The resolution lowered to `f`, held there, with the "running slow" pill (which shares the place) kept away. */
const lowerTo = (page: Page, f: number) =>
  page.evaluate((f) => {
    const c = window.__squib!.controller as unknown as Hooks;
    c.watchPace = () => {};
    c.runningSlow = undefined;
    c.dynRes.enabled = false;
    c.view.setDynamicScale(f);
    c.publish(true);
  }, f);

/** A real pointer click at the middle of an element: it lands on whatever is on top there. */
async function pointerClick(page: Page, testId: string) {
  const b = (await page.getByTestId(testId).boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}

test('the resolution notice: its link and its × take clicks, and it is said once a visit', async ({ page }) => {
  test.setTimeout(240_000 * CI_SLOW);
  const errors = await ready(page);
  const pill = page.getByTestId('quality-pill');
  await lowerTo(page, 0.7);
  await expect(pill).toContainText('Resolution lowered to 70%', { timeout: 30_000 * CI_SLOW });
  // "Keep full quality", clicked with the pointer: automatic quality goes off and the resolution comes back.
  await pointerClick(page, 'keep-quality');
  await expect.poll(() => page.evaluate(() => window.__squib!.controller.getState().autoLowerGraphics), { timeout: 30_000 * CI_SLOW }).toBe(false);
  await expect(pill).toHaveCount(0);
  expect(await page.evaluate(() => window.__squib!.controller.getState().dynamicScale)).toBeUndefined();
  // Lowered again: the notice can be dismissed, and it does not come back for a later change.
  await lowerTo(page, 0.6);
  await expect(pill).toContainText('Resolution lowered to 60%', { timeout: 30_000 * CI_SLOW });
  await pointerClick(page, 'quality-dismiss');
  await expect(pill).toHaveCount(0);
  await lowerTo(page, 0.5);
  await expect.poll(() => page.evaluate(() => window.__squib!.controller.getState().dynamicScale), { timeout: 30_000 * CI_SLOW }).toBe(0.5);
  await expect(pill).toHaveCount(0);
  // The resolution in use is still told in Settings.
  await page.evaluate(() => window.__squib!.controller.toggleSettings(true));
  await expect(page.getByTestId('resolution-now')).toContainText('resolution at 50% now', { timeout: 60_000 * CI_SLOW });
  expect(errors).toEqual([]);
});

test('the resolution notice goes by itself after a quarter of a minute', async ({ page }) => {
  test.setTimeout(240_000 * CI_SLOW);
  const errors = await ready(page);
  const pill = page.getByTestId('quality-pill');
  await lowerTo(page, 0.7);
  await expect(pill).toContainText('Resolution lowered to 70%', { timeout: 30_000 * CI_SLOW });
  await expect(pill).toHaveCount(0, { timeout: 45_000 * CI_SLOW });
  // The resolution itself is unchanged: only the notice went.
  expect(await page.evaluate(() => window.__squib!.controller.getState().dynamicScale)).toBe(0.7);
  expect(errors).toEqual([]);
});
