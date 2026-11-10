import { expect, test } from '@playwright/test';

/** Ghost racing: this run raced again, with it beside you as a see-through boat (no contact). */
const CI_SLOW = process.env.CI ? 2 : 1;

test('race this run as a ghost: the same scenario from the start, with a see-through boat where the recording was', async ({ page }) => {
  test.setTimeout(150_000 * CI_SLOW);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?nowelcome&quality=low');
  await expect(page.getByTestId('stw')).toBeVisible();
  // The River Dart data restarts the run when it arrives: sail after that.
  await page.waitForFunction(() => window.__squib!.controller.getState().dart.status !== 'loading', null, { timeout: 60_000 * CI_SLOW });
  await page.evaluate(() => {
    const c = window.__squib!.controller;
    c.press('helmLeft', true);
    window.__squib!.advance(5);
    c.press('helmLeft', false);
    window.__squib!.advance(20);
  });
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByTestId('ghost-this-run').click();
  await expect(page.getByTestId('ghost-chip')).toBeVisible({ timeout: 60_000 * CI_SLOW });
  const r = await page.evaluate(() => {
    const c = window.__squib!.controller as unknown as { sim: { time: number }; view: { scene: { getObjectByName(n: string): { traverse(f: (o: { isMesh?: boolean; material?: { transparent: boolean; opacity: number } }) => void): void } | undefined } } };
    const boat = c.view.scene.getObjectByName('fleet-boat-ghost');
    let meshes = 0;
    let seeThrough = 0;
    boat?.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      meshes++;
      if (o.material.transparent && o.material.opacity < 0.5) seeThrough++;
    });
    return { time: c.sim.time, found: !!boat, meshes, seeThrough };
  });
  expect(r.found).toBe(true);
  expect(r.time).toBeLessThan(5);
  expect(r.meshes).toBeGreaterThan(10);
  expect(r.seeThrough).toBe(r.meshes);
  await page.getByRole('button', { name: 'Stop the ghost' }).click();
  await expect(page.getByTestId('ghost-chip')).toBeHidden();
  expect(errors).toEqual([]);
});
