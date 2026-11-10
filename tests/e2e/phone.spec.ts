import { expect, test } from '@playwright/test';

/** Phones and tablets: drag the tiller to steer; the battery saver (30 frames a second) is on by default there. */
const CI_SLOW = process.env.CI ? 2 : 1;

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('drag the tiller to steer; the battery saver draws at most 30 frames a second', async ({ page }) => {
    test.setTimeout(120_000 * CI_SLOW);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/?nowelcome&quality=low');
    await expect(page.getByTestId('stw')).toBeVisible();
    expect(await page.evaluate(() => window.__squib!.controller.getState().prefs.batterySaver)).toBe(true);
    // Frames drawn in 3 s of wall time (the counter the frame loop keeps).
    const fps = await page.evaluate(async () => {
      const c = window.__squib!.controller as unknown as { frames: number; fpsT0: number; fps: number };
      await new Promise((r) => setTimeout(r, 3000));
      return c.fps;
    });
    expect(fps).toBeLessThanOrEqual(32);
    // Drag the tiller to the left of the picture: tiller to port, so the helm goes to starboard (+).
    const t = page.getByTestId('tiller-drag');
    await t.scrollIntoViewIfNeeded();
    const box = (await t.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 2, box.y + box.height / 2, { steps: 4 });
    await page.evaluate(() => window.__squib!.advance(1.5));
    const held = await page.evaluate(() => window.__squib!.controller.sim.input.helm);
    expect(held).toBeGreaterThan(0.8);
    await page.mouse.up();
    await page.evaluate(() => window.__squib!.advance(1.5));
    // Let go: back to the middle, as with the keys.
    expect(Math.abs(await page.evaluate(() => window.__squib!.controller.sim.input.helm))).toBeLessThan(0.05);
    expect(errors).toEqual([]);
  });
});
