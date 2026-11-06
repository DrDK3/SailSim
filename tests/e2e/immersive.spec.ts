import { expect, test, type Page } from '@playwright/test';

/**
 * Owner review, 5 Nov 2026 (second): the keys steer after a camera is chosen from its list; Start Bay is a race
 * choice in plain view with today's challenge kept; the minimap's scale is under the map, not drawn on it; the dock
 * is two rows on a laptop. 6 Nov 2026: no status line along the bottom; the console a slim band that leaves the
 * Squib in view.
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

test('at every width the console’s modules hold their contents at their widest, and the console clears the minimap', async ({ page }) => {
  test.setTimeout(150_000 * CI_SLOW);
  const errors = await ready(page);
  // The widest state: every control shown (Expert, crew by hand) and every figure at 100%.
  await page.evaluate(() => {
    const c = window.__squib!.controller;
    c.setLevel('expert');
    c.setInput({ autoCrew: false, crewHike: 1, flatten: 1, autoMain: false, mainSheet: 1 });
  });
  await expect(page.getByRole('button', { name: /^Crew hiking out: 100%/ })).toBeVisible();
  // One slim band (75 px) from 820 px wide, the key letters left off under 990 px; two bands (145 px) on a tablet
  // held upright; three rows on a phone (215 px). Under 1180 px the minimap stands above the band's right-hand end.
  const sizes = [
    [360, 640, 215],
    [390, 844, 215],
    [700, 800, 215],
    [768, 1024, 145],
    [820, 600, 75],
    [989, 600, 75],
    [1000, 560, 75],
    [1179, 700, 75],
    [1180, 800, 75],
    [1366, 768, 75],
    [1920, 1080, 75],
  ] as const;
  for (const [width, height, consoleH] of sizes) {
    await page.setViewportSize({ width, height });
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const bad: string[] = [];
            const con = document.querySelector<HTMLElement>('.panel.dock.console')!;
            const c = con.getBoundingClientRect();
            for (const mod of con.querySelectorAll<HTMLElement>('.mod')) {
              const m = mod.getBoundingClientRect();
              const cs = getComputedStyle(mod);
              const left = m.left + parseFloat(cs.paddingLeft);
              const right = m.right - parseFloat(cs.paddingRight);
              for (const el of mod.querySelectorAll<HTMLElement>(':scope > .mod-top > *, :scope > .mod-row > *')) {
                const r = el.getBoundingClientRect();
                if (r.width > 0 && !el.classList.contains('sr-only') && (r.left < left - 1 || r.right > right + 1)) bad.push(`${mod.getAttribute('aria-label')}: “${el.textContent?.trim()}” runs out of its module`);
              }
            }
            if (c.left < 0 || c.right > window.innerWidth || c.bottom > window.innerHeight) bad.push('console off the screen');
            const map = document.querySelector('.minimap')?.getBoundingClientRect();
            const tab = con.querySelector('.controls-hide')!.getBoundingClientRect();
            const meets = (a: DOMRect, b: DOMRect) => a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;
            if (map && map.width > 0 && meets(c, map)) bad.push('console under the minimap');
            if (map && map.width > 0 && meets(tab, map)) bad.push('hide tab under the minimap');
            return [Math.round(c.height), ...bad];
          }),
        { message: `${width}×${height}`, timeout: 30_000 * CI_SLOW },
      )
      .toEqual([consoleH]);
  }
  expect(errors).toEqual([]);
});

test('the Squib is drawn above the console in the chase and top-down views; no status line along the bottom', async ({ page }) => {
  test.setTimeout(180_000 * CI_SLOW);
  const errors = await ready(page);
  await expect(page.locator('footer.badge')).toHaveCount(0);
  // Each camera at each size, the camera changed once (its swing from one view to the other takes many frames,
  // slow in software rendering).
  for (const cam of ['chase', 'top'] as const) {
    await page.evaluate((m) => window.__squib!.controller.setCamera(m), cam);
    for (const [width, height] of [
      [1000, 560],
      [1280, 800],
      [820, 600],
    ] as const) {
      await page.setViewportSize({ width, height });
      // The hull's lowest point on the screen (its ends and sides, 3 m from its middle), against the console's top.
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              type V = { clone(): V; set(x: number, y: number, z: number): V; project(c: unknown): V; x: number; y: number };
              const view = (window.__squib!.controller as unknown as { view: { camera: unknown; boatRoot: { position: V; localToWorld(v: V): V } } }).view;
              let low = 0;
              for (const [x, z] of [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3]] as const) {
                const p = view.boatRoot.localToWorld(view.boatRoot.position.clone().set(x, 0.3, z)).project(view.camera);
                low = Math.max(low, ((1 - p.y) / 2) * window.innerHeight);
              }
              const top = document.querySelector('.panel.dock.console')!.getBoundingClientRect().top;
              return Math.round(top - low);
            }),
          { message: `${width}×${height}, ${cam}: room between the hull and the console (px)`, timeout: 30_000 * CI_SLOW },
        )
        .toBeGreaterThan(0);
    }
  }
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
