import { expect, test } from '@playwright/test';

/**
 * Daylight view (owner, 10 Nov 2026: "an option to switch to day mode if it is dark in real time"): a real-time run
 * after sunset offers it; the picture is then lit as at midday while the run stays real.
 */
const CI_SLOW = process.env.CI ? 2 : 1;

test('dark in real time: the card offers a daylight view; the picture lights up, the run is unchanged', async ({ page }) => {
  // Software rendering of the night scene keeps the page busy: each step waits for a frame or two.
  test.setTimeout(240_000 * CI_SLOW);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // 19:30 in Dartmouth on 10 November: two and a half hours after sunset.
  await page.clock.setFixedTime(new Date('2026-11-10T19:30:00Z'));
  await page.goto('/?nowelcome&dark&quality=low');
  await expect(page.getByTestId('stw')).toBeVisible();
  await page.waitForFunction(() => window.__squib!.controller.getState().dart.status !== 'loading', null, { timeout: 60_000 * CI_SLOW });
  // A real-time run (the Real time light, as the deployed site starts with live weather).
  await page.evaluate(() => window.__squib!.controller.setLighting('now'));
  const card = page.getByTestId('dark-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('It is dark on the Dart now');
  type V = { view: { sunDir: { y: number } }; sim: { time: number; state: { n: number } }; sceneWeather(): { sunElevationDeg: number } };
  const dark = await page.evaluate(() => (window.__squib!.controller as unknown as V).sceneWeather().sunElevationDeg);
  expect(dark).toBeLessThan(-15);
  await page.getByTestId('dark-daylight').click();
  await expect(card).toBeHidden();
  const r = await page.evaluate(async () => {
    const c = window.__squib!.controller as unknown as V & { getState(): { light: { daylightView: boolean; dark: boolean; clock: string } } };
    await new Promise((res) => setTimeout(res, 1500));
    return { el: c.sceneWeather().sunElevationDeg, sunUp: c.view.sunDir.y, light: c.getState().light };
  });
  expect(r.el).toBeGreaterThan(18);
  expect(r.sunUp).toBeGreaterThan(0.3);
  // The run is still the real evening.
  expect(r.light.dark).toBe(true);
  expect(r.light.daylightView).toBe(true);
  expect(r.light.clock).toBe('19:30');
  // The Settings menu turns it off again. (Dispatched clicks: with the page's clock fixed, Playwright cannot time the
  // animation frames it uses to see that an element is still.)
  await page.getByRole('button', { name: 'Settings', exact: true }).dispatchEvent('click');
  const item = page.getByRole('menuitemcheckbox', { name: /Daylight view when dark/ });
  await expect(item).toHaveAttribute('aria-checked', 'true');
  await item.dispatchEvent('click');
  await expect.poll(() => page.evaluate(() => (window.__squib!.controller as unknown as { prefs: { daylightView: boolean } }).prefs.daylightView), { timeout: 60_000 * CI_SLOW }).toBe(false);
  expect(await page.evaluate(() => (window.__squib!.controller as unknown as V).sceneWeather().sunElevationDeg)).toBeLessThan(-15);
  expect(errors).toEqual([]);
});
