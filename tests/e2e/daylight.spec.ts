import { expect, test } from '@playwright/test';

/**
 * Daylight view (owner, 10 Nov 2026: "an option to switch to day mode if it is dark in real time"): a real-time run
 * after sunset offers it; the picture is then lit as at midday while the run stays real.
 */
const CI_SLOW = process.env.CI ? 2 : 1;
// Issue 202 (review #30): this file failed in some CI runs and passed in others on the same code, and the failures left
// no trace. Keep a trace of any failing run so the cause can be read from it (no retries added for it).
test.use({ trace: 'retain-on-failure' });

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

test('the daylight view kept from an earlier visit says so after dark, and the real light is one click away', async ({ page }) => {
  // Owner, 18 Nov 2026: logged on at 20:00 GMT to a sunlit river and took it that real time was not working. The
  // daylight view was on from an earlier evening, and nothing on screen said so.
  test.setTimeout(240_000 * CI_SLOW);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('squib.prefs.v1', JSON.stringify({ daylightView: true })));
  await page.clock.setFixedTime(new Date('2026-11-18T20:00:00Z'));
  await page.goto('/?nowelcome&dark&quality=low');
  await expect(page.getByTestId('stw')).toBeVisible();
  await page.waitForFunction(() => window.__squib!.controller.getState().dart.status !== 'loading', null, { timeout: 60_000 * CI_SLOW });
  await page.evaluate(() => window.__squib!.controller.setLighting('now'));
  type V = { sceneWeather(): { sunElevationDeg: number }; prefs: { daylightView: boolean } };
  // The picture is lit as at midday, the run is the real evening, and the card says which is which.
  const card = page.getByTestId('daylight-card');
  await expect(card).toBeVisible({ timeout: 60_000 * CI_SLOW });
  await expect(card).toContainText('It is dark on the Dart now (20:00');
  await expect(card).toContainText('daylight view you chose before');
  await expect(page.getByTestId('dark-card')).toHaveCount(0);
  expect(await page.evaluate(() => (window.__squib!.controller as unknown as V).sceneWeather().sunElevationDeg)).toBeGreaterThan(15);
  // For as long as the daylight view lights the picture, the instruments say so, with the time.
  const note = page.getByTestId('daylight-note');
  await expect(note).toContainText('Daylight view · it is 20:00, dark on the Dart');
  // Keep it: the card goes, the note stays.
  await page.getByTestId('daylight-keep').dispatchEvent('click');
  await expect(card).toHaveCount(0);
  await expect(note).toBeVisible();
  // The real light: night, the note gone, and no card offering the daylight view straight back.
  await note.getByRole('button', { name: 'Show the real light' }).dispatchEvent('click');
  await expect.poll(() => page.evaluate(() => (window.__squib!.controller as unknown as V).prefs.daylightView), { timeout: 60_000 * CI_SLOW }).toBe(false);
  expect(await page.evaluate(() => (window.__squib!.controller as unknown as V).sceneWeather().sunElevationDeg)).toBeLessThan(-15);
  await expect(note).toHaveCount(0);
  await expect(page.getByTestId('dark-card')).toHaveCount(0);
  await expect(card).toHaveCount(0);
  expect(errors).toEqual([]);
});
