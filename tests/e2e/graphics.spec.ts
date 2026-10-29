import { expect, test, type Page } from '@playwright/test';

/** CI runners draw the scene in software, several times slower (playwright.config.ts). */
const CI_SLOW = process.env.CI ? 2 : 1;

/**
 * The graphics round: the Graphics and sound panel (presets kept across a reload, the sound's mute), the
 * scenic camera, and the chase camera's zoom. Visual settings never change the simulation.
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

test('graphics and sound: presets apply and are kept, sound mutes with U, the physics is untouched', async ({ page }) => {
  test.setTimeout(180_000 * CI_SLOW);
  const errors = await ready(page);
  const before = await page.evaluate(() => window.__squib!.input());
  // The canvas's pixels per CSS pixel: the resolution the preset draws at.
  const scale = () => page.evaluate(() => {
    const c = document.querySelector('canvas')!;
    return c.width / c.clientWidth;
  });
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: /Graphics and sound/ }).click();
  const panel = page.getByTestId('settings-panel');
  await expect(panel).toBeVisible();
  // A software renderer starts on Performance.
  await expect(panel.getByRole('radio', { name: 'Performance' })).toHaveAttribute('aria-checked', 'true');
  const s0 = await scale();
  await panel.getByRole('radio', { name: 'Ultra' }).click();
  await expect.poll(() => page.evaluate(() => window.__squib!.controller.getState().graphics?.preset)).toBe('ultra');
  // Ultra draws at full resolution, Performance at three quarters.
  await expect.poll(scale).toBeGreaterThan(s0);
  // Scenery and shadows need a reload: the panel says so.
  await expect(panel).toContainText('take effect when the page is reloaded');
  // A single option makes it a custom mix.
  await panel.getByLabel(/Spray from the bow/).uncheck();
  await expect.poll(() => page.evaluate(() => window.__squib!.controller.getState().graphics?.preset)).toBe('custom');
  // Kept in the browser.
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('squib.graphics.v1') ?? 'null'));
  expect(stored.spray).toBe(false);
  expect(stored.water).toBe('high');
  await panel.getByRole('button', { name: 'Close' }).click();
  // Sound: U toggles the mute, and the setting is kept.
  const muted = () => page.evaluate(() => window.__squib!.controller.getState().audio.muted);
  const m0 = await muted();
  await page.keyboard.press('u');
  await expect.poll(muted).toBe(!m0);
  await page.keyboard.press('u');
  await expect.poll(muted).toBe(m0);
  // The controls are as they were: visual settings do not touch the simulation.
  expect(await page.evaluate(() => window.__squib!.input())).toEqual(before);
  expect(errors).toEqual([]);
});

test('cameras: the scenic view circles the boat low and well off; the wheel zooms the chase view', async ({ page }) => {
  test.setTimeout(180_000 * CI_SLOW);
  const errors = await ready(page);
  const camera = page.getByRole('combobox', { name: 'Camera' });
  const pose = () => page.evaluate(() => window.__squib!.controller.cameraInfo()!);
  const boat = () => page.evaluate(() => {
    const s = window.__squib!.snapshot() as { e: number; n: number };
    return [s.e, -s.n] as const;
  });
  const dist = async () => {
    const p = (await pose()).position;
    const [x, z] = await boat();
    return Math.hypot(p[0] - x, p[2] - z);
  };
  // Chase: the wheel moves the camera out.
  const d0 = await dist();
  const canvas = page.locator('canvas').first();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 300);
  await expect.poll(dist, { timeout: 20_000 * CI_SLOW }).toBeGreaterThan(d0 + 4);
  // Scenic: far off and low.
  await camera.selectOption('scenic');
  await expect.poll(async () => (await pose()).position[1], { timeout: 20_000 * CI_SLOW }).toBeLessThan(12);
  await expect.poll(dist, { timeout: 20_000 * CI_SLOW }).toBeGreaterThan(20);
  expect(errors).toEqual([]);
});
