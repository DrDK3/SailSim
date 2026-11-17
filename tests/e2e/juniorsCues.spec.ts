import { expect, test } from '@playwright/test';

/**
 * Juniors round, hard rule: presets change beauty, never cues. At every preset (Smooth, Balanced, Ultra) the picture
 * keeps the sails, telltales, heel, wake and bow wave, the gusts on the water, the masthead burgee, the marks and the
 * other boats; the gust outlines (a teaching aid) can be switched off without touching the gusts drawn on the water.
 * Software rendering here: the frame loop runs slowly, so waits are on the app's state.
 */
const CI_SLOW = process.env.CI ? 2 : 1;

test('every sailing cue is drawn at every graphics preset, and the gust outlines are removable', async ({ page }) => {
  test.setTimeout(300_000 * CI_SLOW);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?nowelcome&quality=low');
  await page.waitForFunction(() => window.__squib!.controller.getState().dart.status !== 'loading', null, { timeout: 90_000 * CI_SLOW });
  // A race in Start Bay in a fresh, gusty breeze with three AI boats, a minute after the start.
  await page.evaluate(() => {
    const c = window.__squib!.controller;
    c.restart({
      conditions: { startTime: '2026-07-15T13:00:00Z', weather: { source: 'manual', twsKn: 16, twdDeg: 225 }, gusts: { preset: 'gusty', seed: 4 }, current: { mode: 'none' } },
      startLocation: 'start-bay-practice', startHeadingDeg: 315, startSpeedKn: 4,
      course: { source: 'practice', kind: 'windward-leeward' }, race: { sequence: 'one-minute', startInS: 30 }, fleet: { aiCount: 3, level: 'good', prepFlag: 'P' },
    });
    window.__squib!.advance(60);
  });
  for (const label of ['Smooth', 'Balanced', 'Ultra']) {
    await page.evaluate(() => window.__squib!.controller.toggleSettings(true));
    await page.getByRole('radio', { name: label, exact: true }).click();
    await page.evaluate(() => window.__squib!.controller.toggleSettings(false));
    // Two drawn frames at this preset.
    const f0 = await page.evaluate(() => window.__squib!.controller.getState().fps);
    void f0;
    await page.waitForFunction(() => {
      const w = window as unknown as { __n?: number };
      w.__n = (w.__n ?? 0) + 1;
      return w.__n > 2 && (window.__squib!.controller.cueAudit()?.puffsDrawn ?? 0) > 0;
    }, null, { timeout: 120_000 * CI_SLOW, polling: 'raf' });
    const a = await page.evaluate(() => window.__squib!.controller.cueAudit());
    expect(a, label).toBeDefined();
    expect(a!.sails, `${label}: sails`).toBe(true);
    expect(a!.telltales, `${label}: telltales`).toBeGreaterThanOrEqual(6);
    expect(Math.abs(a!.heelDrawn), `${label}: heel`).toBeGreaterThan(0.02);
    expect(a!.wake, `${label}: wake`).toBe(true);
    expect(a!.bowWave, `${label}: bow wave`).toBe(true);
    expect(a!.puffsDrawn, `${label}: gusts on the water`).toBeGreaterThan(0);
    expect(a!.vane, `${label}: burgee`).toBe(true);
    expect(a!.marks, `${label}: marks`).toBeGreaterThan(0);
    expect(a!.otherBoats, `${label}: other boats`).toBeGreaterThanOrEqual(3);
    await page.evaluate(() => {
      (window as unknown as { __n?: number }).__n = 0;
    });
  }
  // The gust outlines: on (also in races), then off; the gusts drawn on the water are the same either way.
  const drawn = async () => page.evaluate(() => {
    const c = window.__squib!.controller as unknown as { view: { water: { drawnPuffs(): unknown[] }; gustOutlines: { visible: boolean } } };
    return { puffs: JSON.stringify(c.view.water.drawnPuffs()), outlines: c.view.gustOutlines.visible };
  });
  await page.evaluate(() => window.__squib!.controller.setPrefs({ gustOutlines: true, gustOutlinesInRaces: true }));
  await page.waitForFunction(() => (window.__squib!.controller as unknown as { view: { gustOutlines: { visible: boolean } } }).view.gustOutlines.visible, null, { timeout: 60_000 * CI_SLOW, polling: 'raf' });
  await page.evaluate(() => window.__squib!.controller.togglePause());
  await page.waitForFunction(() => window.__squib!.controller.getState().paused);
  const on = await drawn();
  await page.evaluate(() => window.__squib!.controller.setPrefs({ gustOutlines: false }));
  await page.waitForFunction(() => !(window.__squib!.controller as unknown as { view: { gustOutlines: { visible: boolean } } }).view.gustOutlines.visible, null, { timeout: 60_000 * CI_SLOW, polling: 'raf' });
  const off = await drawn();
  expect(on.outlines).toBe(true);
  expect(off.outlines).toBe(false);
  expect(off.puffs).toBe(on.puffs);
  // And outlines are off in a race unless asked for.
  await page.evaluate(() => window.__squib!.controller.setPrefs({ gustOutlines: true, gustOutlinesInRaces: false }));
  await page.waitForFunction(() => !(window.__squib!.controller as unknown as { view: { gustOutlines: { visible: boolean } } }).view.gustOutlines.visible, null, { timeout: 60_000 * CI_SLOW, polling: 'raf' });
  expect(errors).toEqual([]);
});
