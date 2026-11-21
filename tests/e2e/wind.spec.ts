import { expect, test, type Page } from '@playwright/test';

/**
 * Next round, package A1 (review #1–#4, 20 Nov 2026): make the wind visible. The masthead, where the wind indicator
 * flies, is kept clear of the interface; the masthead's picture by the compass reads the same apparent wind and has a
 * text alternative; the indicator can be a burgee or a vane; T (or the console's button) looks up at it. Software
 * rendering only: positions are measured, not judged by eye.
 */
const CI_SLOW = process.env.CI ? 2 : 1;

async function ready(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?nowelcome&conditions=set&quality=low');
  await expect(page.getByTestId('stw')).toBeVisible();
  await page.waitForFunction(() => window.__squib!.controller.getState().dart.status !== 'loading', null, { timeout: 60_000 * CI_SLOW });
  return errors;
}

/**
 * The masthead's box on the screen and every interface element whose box meets it (the 3D view's own canvas aside,
 * and containers as big as the window, which draw nothing). Read in one call, so the frame and the layout agree.
 */
const masthead = (page: Page) =>
  page.evaluate(() => {
    const view = (window.__squib!.controller as unknown as { view: { mastheadScreen?: { x: number; y: number; l: number; t: number; r: number; b: number } } }).view;
    const m = view.mastheadScreen;
    if (!m) return { m: undefined, covering: ['masthead behind the camera'] };
    const W = innerWidth;
    const H = innerHeight;
    const covering: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      if (el.tagName === 'CANVAS' && el.closest('[data-testid="viewport"]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || (r.width >= W - 1 && r.height >= H - 1)) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
      if (r.left < m.r && r.right > m.l && r.top < m.b && r.bottom > m.t) covering.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`);
    }
    return { m, covering };
  });

for (const size of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]) {
  test.describe(`at ${size.width}×${size.height}`, () => {
    test.use({ viewport: size, hasTouch: size.width < 700, isMobile: size.width < 700 });

    test('the masthead is clear of the toolbar, the instruments, the notices and the labels in the chase view', async ({ page }) => {
      test.setTimeout(150_000 * CI_SLOW);
      const errors = await ready(page);
      // Paused, so the "Paused" notice is up too (it used to sit at the top centre, over the masthead).
      await page.evaluate(() => {
        const c = window.__squib!.controller;
        c.setCamera('chase');
        if (!c.getState().paused) c.togglePause();
      });
      await expect(page.getByText('Paused (P to resume)')).toBeVisible();
      // The framing eases in over a few frames: poll until the masthead is clear (or say what covers it).
      await expect.poll(async () => (await masthead(page)).covering, { timeout: 60_000 * CI_SLOW, message: 'elements over the masthead' }).toEqual([]);
      const { m } = await masthead(page);
      expect(m!.x).toBeGreaterThan(0);
      expect(m!.x).toBeLessThan(size.width);
      expect(m!.t).toBeGreaterThan(0);
      // Labels on (Expert shows them): none is drawn over the masthead; any that would be is hidden for the draw.
      await page.evaluate(() => {
        const c = window.__squib!.controller;
        if (!c.getState().showLabels) c.toggleLabels();
      });
      await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
      const hidden = await page.evaluate(() => (window.__squib!.controller as unknown as { view: { labelsHiddenForMasthead: number } }).view.labelsHiddenForMasthead);
      expect(hidden).toBeGreaterThanOrEqual(0);
      expect(errors).toEqual([]);
    });
  });
}

test('the masthead picture: a text alternative, the burgee flying downwind, the vane pointing into the wind, and it can be hidden', async ({ page }) => {
  test.setTimeout(150_000 * CI_SLOW);
  const errors = await ready(page);
  const inset = page.getByTestId('masthead-inset');
  await expect(inset).toBeVisible();
  // The lowest preset (software rendering): the 2D drawing.
  await expect(inset).toHaveAttribute('data-kind', '2d');
  await expect(inset).toHaveAttribute('role', 'img');
  await expect(inset).toHaveAttribute('aria-label', /^Wind indicator: (wind from (\d+° to (starboard|port) of the bow|dead ahead|dead astern)|hanging limp.*)$/);
  // The drawing reads the same apparent wind as the burgee: the fly points away from where the wind comes from.
  const read = () =>
    page.evaluate(() => {
      const s = window.__squib!.controller.getState().snapshot;
      const g = document.querySelector('[data-testid="inset-burgee"]') ?? document.querySelector('[data-testid="inset-vane"]');
      const rot = Number(/rotate\(([-\d.]+)\)/.exec(g?.getAttribute('transform') ?? '')?.[1]);
      return { awaDeg: (s.awa * 180) / Math.PI, rot, label: document.querySelector('[data-testid="masthead-inset"]')!.getAttribute('aria-label') };
    });
  const b = await read();
  expect(Math.abs(((b.rot - (b.awaDeg + 180) + 540) % 360) - 180)).toBeLessThan(0.2);
  const side = b.awaDeg > 0 ? 'starboard' : 'port';
  expect(b.label).toContain(Math.abs(b.awaDeg) < 2.5 || Math.abs(b.awaDeg) > 177.5 ? 'dead' : side);
  // The vane: its arrow points into the wind, with two tacking tabs; the boat's masthead flies it too.
  await page.evaluate(() => window.__squib!.controller.setPrefs({ windIndicator: 'vane', vaneTabDeg: 35 }));
  await expect(page.getByTestId('inset-vane')).toBeVisible();
  const v = await read();
  expect(Math.abs(((v.rot - v.awaDeg + 540) % 360) - 180)).toBeLessThan(0.2);
  await expect(page.locator('.inset-tab')).toHaveCount(2);
  expect(await page.evaluate(() => (window.__squib!.controller as unknown as { view: { boat: { indicator: string } } }).view.boat.indicator)).toBe('vane');
  // Kept in the browser: a reload keeps the vane.
  await page.reload();
  await expect(page.getByTestId('stw')).toBeVisible();
  await expect(page.getByTestId('inset-vane')).toBeVisible({ timeout: 60_000 * CI_SLOW });
  // Settings → Masthead picture hides it.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Masthead picture' }).click();
  await expect(inset).toHaveCount(0);
  await page.evaluate(() => window.__squib!.controller.setPrefs({ windIndicator: 'burgee', mastheadInset: true }));
  expect(errors).toEqual([]);
});

test('look up: T eases the view up the mast in the chase, helm and orbit views and back on release; the sailing is untouched', async ({ page }) => {
  test.setTimeout(180_000 * CI_SLOW);
  const errors = await ready(page);
  type V = { view: { lookUpAmount: number; camera: { matrixWorld: { elements: number[] } } } };
  // How far above the horizon the camera looks (deg): its forward axis is the matrix's third column, negated.
  const pitchUp = () =>
    page.evaluate(() => {
      const view = (window.__squib!.controller as unknown as V).view;
      const e = view.camera.matrixWorld.elements;
      const y = -e[9]! / Math.hypot(e[8]!, e[9]!, e[10]!);
      return { u: view.lookUpAmount, up: Math.asin(Math.max(-1, Math.min(1, y))) * (180 / Math.PI) };
    });
  // Paused, so nothing but the keys could move the controls (the picture still draws, and the camera with it).
  await page.evaluate(() => {
    const c = window.__squib!.controller;
    if (!c.getState().paused) c.togglePause();
  });
  // Frames advance the camera (its blend runs on frame time): wait for a few to be drawn.
  const frames = (n: number) => page.evaluate((k) => new Promise<void>((done) => {
    let i = 0;
    const f = () => (++i >= k ? done() : requestAnimationFrame(f));
    requestAnimationFrame(f);
  }), n);
  for (const cam of ['chase', 'helm', 'orbit'] as const) {
    await page.evaluate((c) => window.__squib!.controller.setCamera(c), cam);
    await frames(3);
    const input = await page.evaluate(() => JSON.stringify(window.__squib!.input()));
    await page.keyboard.down('KeyT');
    await expect.poll(async () => (await pitchUp()).u, { timeout: 60_000 * CI_SLOW, message: `${cam}: looking up` }).toBeGreaterThan(0.9);
    // Looking up the mast: well above the horizon.
    expect((await pitchUp()).up, cam).toBeGreaterThan(35);
    // A view change only: the boat's controls are as they were.
    expect(await page.evaluate(() => JSON.stringify(window.__squib!.input()))).toBe(input);
    await page.keyboard.up('KeyT');
    await expect.poll(async () => (await pitchUp()).u, { timeout: 60_000 * CI_SLOW, message: `${cam}: back` }).toBeLessThan(0.02);
    expect((await pitchUp()).up, cam).toBeLessThan(25);
  }
  // The console's button does the same while held.
  await page.evaluate(() => window.__squib!.controller.setCamera('chase'));
  const btn = page.getByTestId('look-up');
  await expect(btn).toHaveAccessibleName(/Look up at the masthead/);
  await btn.dispatchEvent('pointerdown', { pointerId: 1 });
  await expect.poll(async () => (await pitchUp()).u, { timeout: 60_000 * CI_SLOW }).toBeGreaterThan(0.9);
  await btn.dispatchEvent('pointerup', { pointerId: 1 });
  await expect.poll(async () => (await pitchUp()).u, { timeout: 60_000 * CI_SLOW }).toBeLessThan(0.02);
  expect(errors).toEqual([]);
});

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('look up cuts to the masthead and back, without easing', async ({ page }) => {
    test.setTimeout(120_000 * CI_SLOW);
    const errors = await ready(page);
    await page.evaluate(() => window.__squib!.controller.setCamera('chase'));
    const u = () => page.evaluate(() => (window.__squib!.controller as unknown as { view: { lookUpAmount: number } }).view.lookUpAmount);
    const oneFrame = () => page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
    await page.keyboard.down('KeyT');
    await oneFrame();
    expect(await u()).toBe(1);
    await page.keyboard.up('KeyT');
    await oneFrame();
    expect(await u()).toBe(0);
    expect(errors).toEqual([]);
  });
});
