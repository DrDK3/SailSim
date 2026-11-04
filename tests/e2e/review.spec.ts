import { expect, test } from '@playwright/test';

/** CI runners draw the scene in software, several times slower (playwright.config.ts). */
const CI_SLOW = process.env.CI ? 2 : 1;

/**
 * Comprehensive review, Package 1 (docs/COMPREHENSIVE_REVIEW.md §11): the browser takes the GPU context away
 * (GR-3) — the run pauses and says so, and carries on when the picture comes back; race restarts give their
 * GPU memory back (GR-2).
 */
test('a lost graphics context pauses the run, says so, and the run carries on when it is restored', async ({ page }) => {
  test.setTimeout(180_000 * CI_SLOW);
  await page.goto('/?nowelcome');
  await expect(page.getByTestId('stw')).toBeVisible();
  await page.waitForFunction(() => window.__squib!.controller.getState().dart.status !== 'loading', null, { timeout: 60_000 * CI_SLOW });
  const ext = await page.evaluateHandle(() => {
    const c = document.querySelector('canvas')!;
    return (c.getContext('webgl2') ?? c.getContext('webgl'))!.getExtension('WEBGL_lose_context')!;
  });
  await page.evaluate((x) => x.loseContext(), ext);
  await expect(page.getByTestId('graphics-lost')).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => page.evaluate(() => window.__squib!.controller.getState().paused), { timeout: 30_000 * CI_SLOW }).toBe(true);
  const t0 = await page.evaluate(() => window.__squib!.controller.getState().snapshot.t);
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => window.__squib!.controller.getState().snapshot.t)).toBe(t0);
  await page.evaluate((x) => x.restoreContext(), ext);
  await expect(page.getByTestId('graphics-lost')).toBeHidden({ timeout: 20_000 * CI_SLOW });
  // After a restore three.js rebuilds every shader: in software rendering the page is busy for a while.
  await expect.poll(() => page.evaluate(() => window.__squib!.controller.getState().paused), { timeout: 60_000 * CI_SLOW }).toBe(false);
  await expect.poll(() => page.evaluate(() => window.__squib!.controller.getState().snapshot.t), { timeout: 60_000 * CI_SLOW }).toBeGreaterThan(t0);
});

test('race restarts give their GPU memory back', async ({ page }) => {
  test.setTimeout(300_000 * CI_SLOW);
  await page.goto('/?nowelcome');
  await expect(page.getByTestId('stw')).toBeVisible();
  await page.waitForFunction(() => window.__squib!.controller.getState().dart.status !== 'loading', null, { timeout: 60_000 * CI_SLOW });
  const counts: number[] = [];
  for (let i = 0; i < 6; i++) {
    // The same race each time: the same marks, boats and labels. The scenery streams in for the first few
    // seconds after a restart, so each count is taken once it has settled.
    await page.evaluate(() => window.__squib!.controller.startQuickRace({ competitors: 6, level: 'good', venue: 'start-bay', course: 'windward-leeward', conditions: 'random', wind: 'any', seed: 3, sequence: 'one-minute' }));
    await page.waitForTimeout(5000);
    counts.push(await page.evaluate(() => (window.__squib!.controller as unknown as { view: { renderer: { info: { memory: { geometries: number } } } } }).view.renderer.info.memory.geometries));
  }
  // Before the fix each restart left about 55 geometries behind (over 100 across these two); now the count holds.
  expect(counts[5]! - counts[3]!).toBeLessThan(20);
});

/**
 * The club documents round (docs/CLUB_DOCUMENTS.md): a quick race on an RDYC course from the 2026 sailing
 * instructions. The course is chosen for the wind, labelled as awaiting a club check, and the committee boat
 * is placed for the wind in the water.
 */
test('quick race on an RDYC club course: labelled pending a club check, committee boat in the water', async ({ page }) => {
  test.setTimeout(180_000 * CI_SLOW);
  await page.goto('/?nowelcome');
  await expect(page.getByTestId('stw')).toBeVisible();
  await page.waitForFunction(() => window.__squib!.controller.getState().dart.status === 'loaded', null, { timeout: 60_000 * CI_SLOW });
  const r = await page.evaluate(() => window.__squib!.controller.startQuickRace({ competitors: 4, level: 'good', venue: 'rdyc', course: 'windward-leeward', conditions: 'random', wind: 'any', seed: 5, sequence: 'one-minute' }));
  expect(r?.summary).toMatch(/2026 sailing instructions \(awaiting a club check\)/);
  const info = await page.evaluate(() => {
    const c = window.__squib!.controller as unknown as { race?: { course: { id: string; status: string; marks: { id: string; position?: { n: number; e: number } }[] } }; dartData?: { geo?: { bedElevation(n: number, e: number): number } } };
    const cb = c.race!.course.marks.find((m) => m.id === 'CB')!;
    return { id: c.race!.course.id, status: c.race!.course.status, depth: c.dartData!.geo!.bedElevation(cb.position!.n, cb.position!.e) };
  });
  expect(info.id).toMatch(/^rdyc-2026-[bc]\d$/);
  expect(info.status).toBe('pending-check');
  expect(info.depth).toBeLessThan(-5);
});

/**
 * Package 2 (UX-6): a boat over the line at her starting signal is told how to clear herself: sail back to the
 * pre-start side round either end, the nearer end and which way it lies. (Guidance only: rules 28.1 and 29.1 as
 * the simulator applies them, not an adjudication.)
 */
test('over the line at the start: the race panel names the nearer end and which way it lies', async ({ page }) => {
  test.setTimeout(180_000 * CI_SLOW);
  await page.goto('/?nowelcome');
  await expect(page.getByTestId('stw')).toBeVisible();
  await page.waitForFunction(() => window.__squib!.controller.getState().dart.status !== 'loading', null, { timeout: 60_000 * CI_SLOW });
  await page.evaluate(() => window.__squib!.controller.startQuickRace({ competitors: 1, level: 'good', venue: 'start-bay', course: 'windward-leeward', conditions: 'random', wind: 'any', seed: 3, sequence: 'one-minute' }));
  await page.evaluate(() => window.__squib!.controller.togglePause());
  const toStart = await page.evaluate(() => window.__squib!.controller.getState().race!.toStart);
  await page.evaluate((s) => window.__squib!.advance(s), toStart - 3);
  // Put the boat 30 m over the line, towards the first mark, three seconds before the gun.
  await page.evaluate(() => {
    const c = window.__squib!.controller as unknown as { race: { resolved: { start: { n: number; e: number }[]; legs: { target: { n: number; e: number } }[] } }; sim: { state: { n: number; e: number; psi: number } } };
    const [a, b] = c.race.resolved.start as [{ n: number; e: number }, { n: number; e: number }];
    const mid = { n: (a.n + b.n) / 2, e: (a.e + b.e) / 2 };
    let nn = -(b.e - a.e);
    let ne = b.n - a.n;
    const len = Math.hypot(nn, ne);
    nn /= len;
    ne /= len;
    const mark = c.race.resolved.legs[0]!.target;
    if ((mark.n - mid.n) * nn + (mark.e - mid.e) * ne < 0) {
      nn = -nn;
      ne = -ne;
    }
    c.sim.state.n = mid.n + nn * 30;
    c.sim.state.e = mid.e + ne * 30;
  });
  await page.evaluate(() => window.__squib!.advance(6));
  const guide = page.getByTestId('ocs-guide');
  await expect(guide).toBeVisible();
  await expect(guide).toContainText('Over the line at the start');
  await expect(guide).toContainText(/Nearer end: (the committee boat|the pin end|.+), \d+ m, (ahead|astern|\d+° to (port|starboard))\./);
});

/** Package 2 (GR-6): the start sequence's sound signals are shown in words while they sound. */
test('the one-minute signal and the start have captions in the race panel', async ({ page }) => {
  test.setTimeout(180_000 * CI_SLOW);
  await page.goto('/?nowelcome');
  await expect(page.getByTestId('stw')).toBeVisible();
  await page.waitForFunction(() => window.__squib!.controller.getState().dart.status !== 'loading', null, { timeout: 60_000 * CI_SLOW });
  await page.evaluate(() => window.__squib!.controller.startQuickRace({ competitors: 1, level: 'good', venue: 'start-bay', course: 'windward-leeward', conditions: 'random', wind: 'any', seed: 3, sequence: 'one-minute' }));
  await page.evaluate(() => window.__squib!.controller.togglePause());
  const toStart = await page.evaluate(() => window.__squib!.controller.getState().race!.toStart);
  await page.evaluate((s) => window.__squib!.advance(s), toStart - 59);
  await expect(page.getByTestId('sound-caption')).toHaveText(/One long sound: one-minute signal/);
  await page.evaluate(() => window.__squib!.advance(60));
  await expect(page.getByTestId('sound-caption')).toHaveText(/One sound: starting signal|One sound: individual recall \(flag X\)/);
  await page.evaluate(() => window.__squib!.advance(8));
  await expect(page.getByTestId('sound-caption')).toBeEmpty();
});

/**
 * Owner review, 4 Nov 2026: painted hulls and racing marks drew black on the owner's graphics card. The graphics
 * check measures painted surfaces where the app runs; here (software rendering) they draw correctly. With the
 * fault simulated, it finds a drawing mode that fixes it and keeps it, and the report says so.
 */
test('graphics check: painted surfaces measured; a simulated fault is fixed by another drawing mode', async ({ page }) => {
  test.setTimeout(180_000 * CI_SLOW);
  await page.goto('/?nowelcome&gpucheck=fault');
  await expect(page.getByTestId('stw')).toBeVisible();
  await page.waitForFunction(() => window.__squib!.controller.getState().dart.status !== 'loading', null, { timeout: 60_000 * CI_SLOW });
  const r = await page.evaluate(() => {
    const c = window.__squib!.controller;
    c.setMaterialMode('none');
    const check = c.runMaterialCheck();
    return { check, mode: c.getState().materialMode, report: c.materialReport() };
  });
  expect(r.check?.fault).toBe(false);
  expect(r.mode).not.toBe('none');
  expect(r.report).toMatch(/FAULT: simulated fault/);
  expect(r.report).toMatch(/white vertex colour \(as the hulls\): 0\.9/);
  // In Settings: the result, the mode in use, and the build.
  await page.evaluate(() => window.__squib!.controller.toggleSettings(true));
  // The panel's code loads on first use: slow in software rendering.
  await expect(page.getByTestId('gpu-check')).toContainText('Painted surfaces draw correctly', { timeout: 30_000 * CI_SLOW });
  await expect(page.getByTestId('gpu-check')).toContainText(/build production-/);
});
