import { expect, test, type Page } from '@playwright/test';

/** CI runners draw the scene in software, several times slower (playwright.config.ts). */
const CI_SLOW = process.env.CI ? 2 : 1;

/**
 * The red-team round: a quick race against a chosen number of boats with the coach, the drone and the
 * first-person helm views, and flattening the sails to depower.
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

test('quick race: choose the competitors, start, read the coach’s briefing, turn the coach off and on', async ({ page }) => {
  test.setTimeout(180_000 * CI_SLOW);
  const errors = await ready(page);
  await page.getByRole('button', { name: 'Race', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Quick race' });
  await expect(panel).toBeVisible();
  await panel.getByLabel('Number of AI competitors').fill('3');
  await expect(panel).toContainText('3 AI boats');
  await panel.getByTestId('quick-race-start').click();
  await expect(panel).toHaveCount(0);
  const st = await page.evaluate(() => window.__squib!.controller.getState());
  expect(st.race?.fleetSize).toBe(4);
  expect(st.scenario.fleet?.aiCount).toBe(3);
  expect(st.scenario.conditions.weather.source).toBe('manual');
  const coach = page.getByTestId('coach');
  await expect(coach).toBeVisible();
  await expect(coach).toContainText('sequence: be on the line at full speed');
  await coach.getByRole('button', { name: 'Off' }).click();
  await expect(coach).toHaveCount(0);
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: /Race coach/ }).click();
  await expect(page.getByTestId('coach')).toBeVisible();
  expect(errors).toEqual([]);
});

test('cameras: the drone climbs, pans and comes back; the helm view looks around and back ahead', async ({ page }) => {
  test.setTimeout(180_000 * CI_SLOW);
  const errors = await ready(page);
  const camera = page.getByRole('combobox', { name: 'Camera' });
  await camera.selectOption('drone');
  await expect(page.getByRole('group', { name: 'Drone view' })).toBeVisible();
  const pose = () => page.evaluate(() => window.__squib!.controller.cameraInfo()!);
  const p0 = await pose();
  const canvas = page.locator('canvas').first();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, 400);
  await expect.poll(async () => (await pose()).position[1], { timeout: 20_000 * CI_SLOW }).toBeGreaterThan(p0.position[1] + 50);
  // Pan with a right-drag: the target moves away from the boat.
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(box.x + box.width / 2 - 250, box.y + box.height / 2 - 150, { steps: 8 });
  await page.mouse.up({ button: 'right' });
  await expect.poll(async () => Math.hypot((await pose()).target[0] - p0.target[0], (await pose()).target[2] - p0.target[2]), { timeout: 20_000 * CI_SLOW }).toBeGreaterThan(50);
  await page.getByRole('button', { name: /Back to boat/ }).click();
  const back = await pose();
  const boat = await page.evaluate(() => { const s = window.__squib!.controller.getState().snapshot; return [s.e, -s.n]; });
  expect(Math.hypot(back.target[0] - boat[0]!, back.target[2] - boat[1]!)).toBeLessThan(30);

  await camera.selectOption('helm');
  await expect(page.getByRole('note', { name: 'Helm view' })).toBeVisible();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 300, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  const look = await page.evaluate(() => window.__squib!.controller.cameraInfo()!.helm);
  expect(look.yaw).toBeGreaterThan(0.3);
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  expect((await page.evaluate(() => window.__squib!.controller.cameraInfo()!.helm)).yaw).toBe(0);
  expect(errors).toEqual([]);
});

test('flatten: Z flattens the sails a quarter at a time, Shift+Z powers them up, the slider follows', async ({ page }) => {
  const errors = await ready(page);
  const flatten = () => page.evaluate(() => window.__squib!.controller.getState().snapshot.input.flatten ?? 0);
  await page.keyboard.press('KeyZ');
  await page.keyboard.press('KeyZ');
  await expect.poll(flatten).toBe(0.5);
  await page.keyboard.press('Shift+KeyZ');
  await expect.poll(flatten).toBe(0.25);
  await expect(page.getByRole('region', { name: 'Sailing controls' })).toContainText('25%');
  expect(errors).toEqual([]);
});
