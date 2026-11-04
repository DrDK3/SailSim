import { expect, test, type Page } from '@playwright/test';

/** Package 2, round B: one race set-up with today's challenge, the start-line view, interface levels, U8 labels. */

const CI_SLOW = process.env.CI ? 2 : 1;

async function ready(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?nowelcome&quality=low');
  await expect(page.getByTestId('stw')).toBeVisible();
  await page.waitForFunction(() => window.__squib!.controller.getState().dart.status !== 'loading', null, { timeout: 60_000 * CI_SLOW });
  return errors;
}

test("today's challenge: the short course against three AI boats; the start-line view looks along the line from the committee boat", async ({ page }) => {
  test.setTimeout(180_000 * CI_SLOW);
  // With reduced motion the view cuts to a new camera instead of blending over several frames (seconds each
  // in software rendering).
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = await ready(page);
  await page.getByRole('button', { name: 'Race', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Race set-up' });
  await expect(panel.getByTestId('daily-challenge')).toContainText('Today’s challenge');
  await panel.getByTestId('challenge-start').click();
  await expect(panel).toHaveCount(0);
  const st = await page.evaluate(() => window.__squib!.controller.getState());
  expect(st.race?.fleetSize).toBe(4);
  expect(st.scenario.course).toEqual({ source: 'practice', kind: 'windward-leeward', legM: 220, laps: 1 });
  // The start-line view: just outside the committee boat end, looking along the line at the pin.
  await page.locator('select[title="Camera (C cycles)"]').selectOption('line');
  // The camera moves there on the next frame drawn.
  const pose = () =>
    page.evaluate(() => {
      const c = window.__squib!.controller as unknown as { race: { resolved: { start: [{ n: number; e: number }, { n: number; e: number }] }; course: { start: { ends: [string, string] }; marks: { id: string; kind: string }[] } }; cameraInfo(): { position: number[] } };
      const [a, b] = c.race.resolved.start;
      const rcFirst = c.race.course.marks.find((m) => m.id === c.race.course.start.ends[0])?.kind === 'committee-boat';
      const rc = rcFirst ? a : b;
      const pin = rcFirst ? b : a;
      const [x, y, z] = c.cameraInfo().position as [number, number, number];
      // three.js: x = east, z = −north.
      return { fromRc: Math.hypot(x - rc.e, -z - rc.n), toPin: Math.hypot(x - pin.e, -z - pin.n), line: Math.hypot(pin.e - rc.e, pin.n - rc.n), y };
    });
  await expect.poll(async () => (await pose()).fromRc, { timeout: 60_000 * CI_SLOW }).toBeLessThan(20);
  const p = await pose();
  expect(p.y).toBeGreaterThan(1);
  expect(p.toPin).toBeGreaterThan(p.line);
  expect(errors).toEqual([]);
});

test('interface levels: Expert shows every instrument without the coach; Learn adds the teaching overlay and a simpler dock', async ({ page }) => {
  test.setTimeout(180_000 * CI_SLOW);
  const errors = await ready(page);
  await page.evaluate(() => window.__squib!.controller.toggleSettings(true));
  const level = page.getByTestId('level');
  await expect(level).toBeVisible({ timeout: 30_000 * CI_SLOW });
  await level.getByLabel('Expert').check();
  await expect(page.getByRole('region', { name: 'Instruments' })).toContainText('SOG');
  expect(await page.evaluate(() => window.__squib!.controller.coachEnabled)).toBe(false);
  await level.getByLabel('Learn').check();
  await expect(page.getByRole('region', { name: 'Instruments' })).not.toContainText('SOG');
  await expect(page.locator('[data-tutorial="flatten"]')).toHaveCount(0);
  expect(await page.evaluate(() => (window.__squib!.controller as unknown as { view: { teaching: { shown: string[] } } }).view.teaching.shown)).toEqual(['heading', 'cog', 'current', 'wind', 'vmg']);
  await level.getByLabel('Club').check();
  await expect(page.locator('[data-tutorial="flatten"]')).toHaveCount(1);
  // The compass tells the two winds apart by letter and line, not by colour alone (U8).
  const compass = page.locator('svg.compass');
  await expect(compass).toHaveAttribute('aria-label', /true wind \(T\) .*apparent wind \(A\)/);
  await expect(compass.locator('text.wind-letter')).toHaveText(['T', 'A']);
  expect(errors).toEqual([]);
});
