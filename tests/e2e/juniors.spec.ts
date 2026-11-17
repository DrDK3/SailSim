import { expect, test } from '@playwright/test';

/**
 * Juniors round, Workstream 1: the device check end to end, game-controller input (navigator.getGamepads mocked),
 * and the touch controls' sizes on a tablet. Time is driven by the app's own frame loop (software rendering: a frame
 * takes seconds here), so waits are on the app's state, not the clock.
 */
const CI_SLOW = process.env.CI ? 2 : 1;

test('device check: runs the fixed route, gives a plain verdict and exports JSON with nothing personal', async ({ page }) => {
  test.setTimeout(240_000 * CI_SLOW);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?nowelcome&quality=low');
  await page.waitForFunction(() => window.__squib!.controller.getState().dart.status !== 'loading', null, { timeout: 90_000 * CI_SLOW });
  await page.evaluate(() => window.__squib!.controller.toggleSettings(true));
  const panel = page.getByTestId('device-check');
  await expect(panel).toBeVisible();
  // The button starts the full check; stop it, then run a short one through the same runner.
  await panel.getByTestId('device-check-start').click();
  await expect(panel.getByRole('button', { name: 'Stop the check' })).toBeVisible();
  const during = await page.evaluate(() => window.__squib!.controller.scenario.conditions.gusts);
  expect(during).toEqual({ preset: 'moderate', seed: 7 });
  await panel.getByRole('button', { name: 'Stop the check' }).click();
  await page.evaluate(() => window.__squib!.controller.startDeviceCheck(6));
  await expect(panel.getByTestId('device-check-result')).toBeVisible({ timeout: 180_000 * CI_SLOW });
  await expect(panel.getByTestId('device-verdict')).toHaveText(/^(Smooth|Mostly smooth|Struggling)$/);
  const report = await page.evaluate(() => window.__squib!.controller.lastDeviceReport);
  expect(report!.schema).toBe('squib-device-check/1');
  expect(report!.frames.frames).toBeGreaterThan(0);
  expect(report!.startup.firstFrameMs).toBeGreaterThan(0);
  expect(report!.startup.sailableMs).toBeGreaterThan(0);
  // Nothing personal: only these keys, and the GPU string, screen and engine family.
  expect(Object.keys(report!).sort()).toEqual(['build', 'cpu', 'device', 'frames', 'graphics', 'input', 'ranAt', 'schema', 'startup', 'verdict']);
  expect(Object.keys(report!.device).every((k) => ['gpu', 'screen', 'pixelRatio', 'memoryGb', 'cpuCores', 'touch', 'engine'].includes(k))).toBe(true);
  expect(JSON.stringify(report)).not.toMatch(/Mozilla|@|localhost/);
  // The scenario sailed before the check is back.
  expect(await page.evaluate(() => window.__squib!.controller.scenario.conditions.gusts.seed)).not.toBe(7);
  // Save as a file: a JSON download.
  const href = await panel.getByTestId('device-check-save').getAttribute('href');
  expect(JSON.parse(decodeURIComponent(href!.split(',')[1]!)).schema).toBe('squib-device-check/1');
  expect(errors).toEqual([]);
});

test('game controller: the stick steers in proportion and the trigger trims, through the app controls (mocked Gamepad API)', async ({ page }) => {
  test.setTimeout(150_000 * CI_SLOW);
  await page.addInitScript(() => {
    const w = window as unknown as { __pad: { axes: number[]; buttons: number[] } };
    w.__pad = { axes: [0, 0, 0, 0], buttons: Array(17).fill(0) };
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => [{ index: 0, id: 'mock', connected: true, mapping: 'standard', timestamp: 0, axes: w.__pad.axes, buttons: w.__pad.buttons.map((v) => ({ value: v, pressed: v > 0.5, touched: v > 0 })) }],
    });
  });
  await page.goto('/?nowelcome&quality=low');
  await page.waitForFunction(() => window.__squib!.controller.getState().dart.status !== 'loading', null, { timeout: 90_000 * CI_SLOW });
  await page.waitForFunction(() => window.__squib!.controller.getState().gamepad === true, null, { timeout: 60_000 * CI_SLOW });
  // Full right stick: the frame loop polls the pad; the helm follows at the keys' rate.
  await page.evaluate(() => {
    (window as unknown as { __pad: { axes: number[] } }).__pad.axes[0] = 1;
  });
  await page.waitForFunction(() => window.__squib!.controller.sim.input.helm > 0, null, { timeout: 60_000 * CI_SLOW });
  await page.evaluate(() => window.__squib!.advance(2));
  expect(await page.evaluate(() => window.__squib!.controller.sim.input.helm)).toBeCloseTo(1, 3);
  // Right trigger: trim the main in.
  await page.evaluate(() => {
    const p = (window as unknown as { __pad: { axes: number[]; buttons: number[] } }).__pad;
    p.axes[0] = 0;
    p.buttons[7] = 1;
  });
  const before = await page.evaluate(() => window.__squib!.controller.sim.currentSheet('main'));
  await page.waitForFunction((b) => window.__squib!.controller.sim.currentSheet('main') < b - 1e-4, before, { timeout: 60_000 * CI_SLOW });
  // Start: pause.
  await page.evaluate(() => {
    const p = (window as unknown as { __pad: { buttons: number[] } }).__pad;
    p.buttons[7] = 0;
    p.buttons[9] = 1;
  });
  await page.waitForFunction(() => window.__squib!.controller.getState().paused, null, { timeout: 60_000 * CI_SLOW });
  // Settings explain the layout and offer the vibration switch.
  await page.evaluate(() => window.__squib!.controller.toggleSettings(true));
  await expect(page.getByTestId('gamepad-help')).toContainText('A game controller is connected');
  await expect(page.getByTestId('pref-haptics')).toBeVisible();
});

test('touch controls on a tablet: every sailing control at least 24 px, and the share at 44 px recorded', async ({ browser }) => {
  test.setTimeout(120_000 * CI_SLOW);
  const ctx = await browser.newContext({ baseURL: 'http://localhost:4173', viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1, storageState: { cookies: [], origins: [{ origin: 'http://localhost:4173', localStorage: [{ name: 'squib.welcomed.v1', value: '1' }] }] } });
  const page = await ctx.newPage();
  await page.goto('/?nowelcome&quality=low');
  await expect(page.getByTestId('stw')).toBeVisible({ timeout: 90_000 * CI_SLOW });
  const sizes = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.controls button, .dock button, .toolbar button')]
      .filter((b) => b.offsetParent !== null)
      .map((b) => {
        const r = b.getBoundingClientRect();
        return { label: b.getAttribute('aria-label') ?? b.textContent?.trim() ?? '', w: Math.round(r.width), h: Math.round(r.height) };
      }),
  );
  expect(sizes.length).toBeGreaterThan(5);
  const small = sizes.filter((s) => Math.min(s.w, s.h) < 24);
  expect(small).toEqual([]);
  const at44 = sizes.filter((s) => Math.min(s.w, s.h) >= 44).length;
  test.info().annotations.push({ type: 'touch targets', description: `${at44} of ${sizes.length} at least 44 px; smallest ${Math.min(...sizes.map((s) => Math.min(s.w, s.h)))} px` });
  console.log(`touch targets: ${at44}/${sizes.length} ≥ 44 px`, JSON.stringify(sizes));
  await ctx.close();
});
