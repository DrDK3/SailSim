import { expect, test, type Page } from '@playwright/test';

/**
 * Owner review, 5 Nov 2026 (second): the keys steer after a camera is chosen from its list; Start Bay is a race
 * choice in plain view with today's challenge kept; the minimap's scale is under the map, not drawn on it; the dock
 * is two rows on a laptop.
 */

const CI_SLOW = process.env.CI ? 2 : 1;

async function ready(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?nowelcome&quality=low');
  await expect(page.getByTestId('stw')).toBeVisible();
  await page.waitForFunction(() => window.__squib!.controller.getState().dart.status !== 'loading', null, { timeout: 60_000 });
  return errors;
}

test('after choosing a camera from its list, A and D steer the boat (and D does not choose the drone)', async ({ page }) => {
  test.setTimeout(120_000 * CI_SLOW);
  const errors = await ready(page);
  const camera = page.getByRole('combobox', { name: 'Camera' });
  for (const mode of ['helm', 'top', 'drone'] as const) {
    // As with a mouse: the list has the focus while it is chosen from.
    await camera.focus();
    await camera.selectOption(mode);
    await page.keyboard.down('KeyD');
    const held = await page.evaluate(() => [...((window.__squib!.controller as unknown as { held: Set<string> }).held ?? [])]);
    await page.keyboard.up('KeyD');
    expect(held.some((a) => /^helm/.test(a)), `steering held in the ${mode} view`).toBe(true);
    expect(await page.evaluate(() => window.__squib!.controller.getState().camera)).toBe(mode);
  }
  expect(errors).toEqual([]);
});

test('Race: today’s challenge first, then where to race with Start Bay chosen; the course follows the place', async ({ page }) => {
  test.setTimeout(120_000 * CI_SLOW);
  await page.evaluate(() => localStorage.removeItem('squib.quickRace.v1')).catch(() => undefined);
  const errors = await ready(page);
  await page.evaluate(() => localStorage.removeItem('squib.quickRace.v1'));
  await page.getByRole('button', { name: 'Race', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Race set-up' });
  await expect(panel.getByTestId('daily-challenge')).toBeVisible();
  const where = panel.getByRole('radiogroup', { name: 'Where' });
  await expect(where.getByRole('radio')).toHaveText(['Start Bay', 'The river', 'RDYC course', 'Library']);
  await expect(where.getByRole('radio', { name: 'Start Bay' })).toHaveAttribute('aria-checked', 'true');
  await expect(panel.getByTestId('race-course')).toHaveValue('short');
  // The library lists its courses; back to Start Bay, its courses again.
  await where.getByRole('radio', { name: 'Library' }).click();
  await expect(where.getByRole('radio', { name: 'Library' })).toHaveAttribute('aria-checked', 'true');
  expect(await panel.getByTestId('race-course').locator('option').count()).toBeGreaterThan(0);
  await where.getByRole('radio', { name: 'Start Bay' }).click();
  await expect(panel.getByTestId('race-course').locator('option').first()).toHaveText(/Short course/);
  expect(errors).toEqual([]);
});

test('the minimap’s scale is under the map, and the dock is two rows beside it on a laptop', async ({ page }) => {
  test.setTimeout(120_000 * CI_SLOW);
  await page.setViewportSize({ width: 1280, height: 800 });
  const errors = await ready(page);
  const map = page.getByTestId('minimap');
  await expect(map).toBeVisible();
  const scale = page.getByTestId('minimap-scale');
  await expect(scale).toHaveText(/\d+(\.\d+)? (m|km)/);
  const [m, sc] = [await map.boundingBox(), await scale.boundingBox()];
  expect(sc!.y).toBeGreaterThanOrEqual(m!.y + m!.height);
  const dock = page.getByRole('region', { name: 'Sailing controls' });
  const d = await dock.boundingBox();
  expect(d!.height).toBeLessThan(100);
  // Clear of the minimap's panel.
  const mapPanel = await page.getByRole('region', { name: 'Minimap' }).boundingBox();
  expect(d!.x + d!.width).toBeLessThanOrEqual(mapPanel!.x);
  expect(errors).toEqual([]);
});

test('the helm console keeps its size as the rudder moves and the sails’ states change; the fix glows', async ({ page }) => {
  test.setTimeout(150_000 * CI_SLOW);
  await page.setViewportSize({ width: 1280, height: 800 });
  const errors = await ready(page);
  const dock = page.getByRole('region', { name: 'Sailing controls' });
  const size = async () => {
    const b = (await dock.boundingBox())!;
    return [Math.round(b.width), Math.round(b.height)];
  };
  const before = await size();
  expect(before[1]).toBeLessThan(100);
  // The main let right out: it luffs, and the button that fixes it (Trim) glows.
  await page.evaluate(() => window.__squib!.controller.setInput({ autoMain: false, mainSheet: 1 }));
  await expect(page.getByTestId('main-status')).toContainText('Luffing');
  await expect(dock.getByRole('button', { name: /^Trim main/ })).toHaveClass(/suggest/);
  expect(await size()).toEqual(before);
  // Hold the helm over: the rudder moves, the readout changes, the console does not.
  await page.keyboard.down('KeyD');
  await expect(dock.locator('.helm-readout')).not.toHaveText('Straight', { timeout: 60_000 });
  expect(await size()).toEqual(before);
  await page.keyboard.up('KeyD');
  expect(errors).toEqual([]);
});
