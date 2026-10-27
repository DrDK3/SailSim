import { expect, test, type Page } from '@playwright/test';

/** CI runners draw the scene in software, several times slower (playwright.config.ts). */
const CI_SLOW = process.env.CI ? 2 : 1;

/** The UX pass: first-visit welcome, the tutorial, toolbar menus, Escape, reset confirmation, phones, watertight boats. */

async function ready(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await expect(page.getByTestId('stw')).toBeVisible();
  await page.waitForFunction(() => window.__squib!.controller.getState().dart.status !== 'loading', null, { timeout: 60_000 });
  return errors;
}

test.describe('first visit', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('the welcome offers the tutorial; the tutorial teaches step by step and moves on when the goal is met', async ({ page }) => {
    test.setTimeout(180_000 * CI_SLOW);
    const errors = await ready(page);
    const welcome = page.getByRole('dialog', { name: 'Squib sailing simulator' });
    await expect(welcome).toBeVisible();
    await expect(welcome.getByRole('button', { name: 'Start the tutorial' })).toBeFocused();
    await welcome.getByRole('button', { name: 'Start the tutorial' }).click();
    await expect(welcome).toBeHidden();

    const card = page.getByTestId('tutorial');
    await expect(card).toContainText('step 1 of 11');
    await expect(page.getByTestId('tutorial-title')).toHaveText('Welcome aboard');
    await expect(page.locator('[data-tutorial="compass"]')).toHaveClass(/tutorial-target/);
    await card.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByTestId('tutorial-title')).toHaveText('Steer');
    await expect(page.locator('[data-tutorial="helm"]')).toHaveClass(/tutorial-target/);
    await expect(page.getByTestId('tutorial-goal')).toContainText('Waiting for you');

    // Steer with the keyboard until the boat has turned 30°.
    await page.evaluate(() => window.__squib!.controller.togglePause());
    await page.keyboard.down('KeyD');
    await page.evaluate(() => {
      for (let i = 0; i < 30 && !window.__squib!.controller.getState().tutorial!.done; i++) window.__squib!.advance(0.5);
    });
    await page.keyboard.up('KeyD');
    await expect(page.getByTestId('tutorial-goal')).toContainText('Done');
    await page.evaluate(() => window.__squib!.advance(2.2));
    await expect(page.getByTestId('tutorial-title')).toHaveText('Sail across the wind');
    await expect(card).toContainText('step 3 of 11');

    await card.getByRole('button', { name: 'End the tutorial' }).click();
    await expect(card).toBeHidden();
    // Seen once: no welcome on the next visit.
    await page.reload();
    await expect(page.getByTestId('stw')).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Squib sailing simulator' })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('"Just sail" (or Escape) closes the welcome without starting anything', async ({ page }) => {
    await ready(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Squib sailing simulator' })).toBeHidden();
    expect(await page.evaluate(() => window.__squib!.controller.getState().tutorial)).toBeUndefined();
  });
});

test('toolbar: the More menu (sections, toggles), Escape closes menus and panels, one side panel at a time', async ({ page }) => {
  const errors = await ready(page);
  // Few controls in view: playback, camera, Race, Library and Scenario, More and Help.
  await expect(page.getByRole('navigation', { name: 'Simulation' }).getByRole('button')).toHaveCount(7);
  const view = page.getByRole('button', { name: 'More', exact: true });
  await view.click();
  const labels = page.getByRole('menuitemcheckbox', { name: /Place labels/ });
  await expect(labels).toHaveAttribute('aria-checked', 'true');
  await labels.click();
  await expect(page.getByRole('menu')).toHaveCount(0); // choosing closes the menu
  expect(await page.evaluate(() => window.__squib!.controller.getState().showLabels)).toBe(false);
  await view.click();
  await expect(page.getByRole('menu', { name: 'More' })).toBeVisible();
  await expect(page.getByRole('menu', { name: 'More' })).toContainText('Physics tools');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);

  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: /Polar sweep/ }).click();
  await expect(page.getByRole('region', { name: /polar/i })).toBeVisible();

  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Library' })).toBeVisible();
  await page.getByRole('button', { name: 'Scenario', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Scenario settings' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Library' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Scenario settings' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: /polar/i })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the sailing controls can be put away and brought back (remembered); the keys still sail the boat', async ({ page }) => {
  // Two full loads of the River Dart (the setting must survive a reload): slow under software rendering.
  test.setTimeout(240_000 * CI_SLOW);
  const errors = await ready(page);
  const dock = page.getByRole('region', { name: 'Sailing controls' });
  await expect(dock).toBeVisible();
  await dock.getByRole('button', { name: 'Hide sailing controls' }).click();
  await expect(dock).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('stw')).toBeVisible();
  // The run restarts when the River Dart data arrives: wait for it before sailing.
  await page.waitForFunction(() => window.__squib!.controller.getState().dart.status !== 'loading', null, { timeout: 60_000 });
  await expect(page.getByRole('region', { name: 'Sailing controls' })).toHaveCount(0);
  // The keys still steer.
  await page.evaluate(() => window.__squib!.controller.togglePause());
  await page.keyboard.down('KeyD');
  await page.evaluate(() => window.__squib!.advance(1));
  await page.keyboard.up('KeyD');
  expect(await page.evaluate(() => window.__squib!.controller.sim.input.helm)).not.toBe(0);
  await page.getByRole('button', { name: 'Show sailing controls' }).click();
  await expect(page.getByRole('region', { name: 'Sailing controls' })).toBeVisible();
  // And from the More menu.
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Sailing controls' }).click();
  await expect(page.getByRole('region', { name: 'Sailing controls' })).toHaveCount(0);
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Sailing controls' }).click();
  await expect(page.getByRole('region', { name: 'Sailing controls' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('sail status in plain words, with the key to press', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    const c = window.__squib!.controller;
    c.togglePause();
    c.setInput({ autoMain: false, mainSheet: 1 }); // main fully eased on a close reach: luffing
    window.__squib!.advance(3);
  });
  await expect(page.getByTestId('main-status')).toContainText('Luffing · trim in (W)');
});

test('reset during a race asks first; R or the button, Keep racing or Restart', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    const c = window.__squib!.controller;
    c.togglePause();
    c.restart({ ...c.scenario, startLocation: 'start-bay-practice', course: { source: 'practice', kind: 'windward-leeward' }, race: { sequence: 'one-minute', startInS: 10 }, fleet: { aiCount: 0, level: 'good', prepFlag: 'P' } });
    window.__squib!.advance(12);
  });
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  const confirm = page.getByTestId('confirm-reset');
  await expect(confirm).toBeVisible();
  await expect(confirm.getByRole('button', { name: 'Keep racing' })).toBeFocused();
  await confirm.getByRole('button', { name: 'Keep racing' }).click();
  await expect(confirm).toBeHidden();
  expect(await page.evaluate(() => window.__squib!.controller.sim.time)).toBeGreaterThan(11);
  await page.keyboard.press('KeyR');
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Restart' }).click();
  await expect(confirm).toBeHidden();
  expect(await page.evaluate(() => window.__squib!.controller.sim.time)).toBeLessThan(1);
});

test('boats are watertight: each boat masks its deck so the sea is not drawn inside the hull', async ({ page }) => {
  await ready(page);
  const r = await page.evaluate(() => {
    const v = (window.__squib!.controller as unknown as { view: { scene: { traverse: (f: (o: { name: string; renderOrder: number; material?: Record<string, unknown> }) => void) => void }; renderer: { getContext: () => WebGL2RenderingContext } } }).view;
    const masks: number[] = [];
    let water: Record<string, unknown> | undefined;
    let waterOrder = 0;
    v.scene.traverse((o) => {
      if (o.name === 'water-mask') masks.push(o.renderOrder);
      if (o.name === 'water') {
        water = o.material;
        waterOrder = o.renderOrder;
      }
    });
    return { masks, stencilBits: v.renderer.getContext().getParameter(0x0d57 /* STENCIL_BITS */), test: water?.stencilWrite, func: water?.stencilFunc, waterOrder };
  });
  expect(r.masks.length).toBeGreaterThan(0);
  expect(r.stencilBits).toBeGreaterThan(0);
  expect(r.test).toBe(true);
  expect(r.func).toBe(517); // NotEqualStencilFunc: no water where a deck was marked
  expect(r.waterOrder).toBeGreaterThan(Math.max(...r.masks));
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('fits the screen: compact instruments, the toolbar behind a Menu button, controls within the width', async ({ page }) => {
    const errors = await ready(page);
    const fits = () =>
      page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && [...document.querySelectorAll('.panel')].every((p) => p.getBoundingClientRect().right <= window.innerWidth + 1));
    expect(await fits()).toBe(true);
    await expect(page.getByRole('button', { name: 'Library', exact: true })).toBeHidden();
    await page.getByRole('button', { name: 'Menu' }).click();
    await expect(page.getByRole('button', { name: 'Library', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close menu' }).click();
    await expect(page.getByRole('button', { name: 'All instruments and conditions' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Steer to starboard/ })).toBeInViewport();
    expect(await fits()).toBe(true);
    expect(errors).toEqual([]);
  });
});
