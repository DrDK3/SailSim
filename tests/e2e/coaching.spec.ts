import { expect, test, type Page } from '@playwright/test';

/**
 * Review, 10 Nov 2026: the debrief after every sail, the protest room and the start readouts. Software rendering
 * only (SwiftShader); the canvases are checked as drawn, not judged by eye.
 */
const CI_SLOW = process.env.CI ? 2 : 1;

async function ready(page: Page) {
  await page.goto('/?nowelcome&quality=low');
  await expect(page.getByTestId('stw')).toBeVisible();
  // The River Dart data restarts the run when it arrives: sail after that.
  await page.waitForFunction(() => window.__squib!.controller.getState().dart.status !== 'loading', null, { timeout: 60_000 * CI_SLOW });
}

test('the debrief after a sail: the track map, the tack and its cost', async ({ page }) => {
  test.setTimeout(150_000 * CI_SLOW);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await ready(page);
  await page.evaluate(() => {
    const c = window.__squib!.controller;
    window.__squib!.advance(40);
    c.press('helmRight', true);
    window.__squib!.advance(10);
    c.press('helmRight', false);
    window.__squib!.advance(40);
  });
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: /Your sail/ }).click();
  const panel = page.getByTestId('debrief');
  await expect(panel).toBeVisible({ timeout: 30_000 * CI_SLOW });
  await expect(panel).toContainText(/Distance/);
  // The track was drawn: the canvas is not one flat colour.
  const varied = await panel.locator('canvas').first().evaluate((cv: HTMLCanvasElement) => {
    const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data;
    const seen = new Set<number>();
    for (let i = 0; i < d.length; i += 4 * 97) seen.add((d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!);
    return seen.size;
  });
  expect(varied).toBeGreaterThan(5);
  const s = await page.evaluate(() => window.__squib!.controller.sailDebrief().summary);
  expect(s.durationS).toBeGreaterThan(60);
  expect(s.tacks.count + s.gybes.count).toBeGreaterThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('the protest room: a contact in a race, watched again with the rule in plain words', async ({ page }) => {
  test.setTimeout(180_000 * CI_SLOW);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await ready(page);
  await page.evaluate(() => window.__squib!.controller.startQuickRace({ competitors: 1, level: 'good', venue: 'start-bay', course: 'windward-leeward', conditions: 'random', wind: 'any', seed: 3, sequence: 'one-minute' }));
  await page.evaluate(() => window.__squib!.controller.togglePause());
  await page.evaluate(() => window.__squib!.advance(20));
  // Put your boat 3.5 m abeam of the other boat (centre to centre), heading for her at 1.5 m/s.
  await page.evaluate(() => {
    type S = { n: number; e: number; psi: number; u: number; v: number; r: number };
    const c = window.__squib!.controller as unknown as { sim: { state: S }; race: { session: { fleet: { boats: { id: string; sim: { state: S } }[] } } } };
    const other = c.race.session.fleet.boats.find((b) => b.id !== 'you')!.sim.state;
    const side = other.psi + Math.PI / 2;
    c.sim.state.n = other.n + Math.cos(side) * 3.5;
    c.sim.state.e = other.e + Math.sin(side) * 3.5;
    c.sim.state.psi = side + Math.PI;
    c.sim.state.u = 1.5;
    c.sim.state.v = 0;
    c.sim.state.r = 0;
  });
  await page.evaluate(() => window.__squib!.advance(8));
  await expect.poll(() => page.evaluate(() => window.__squib!.controller.getState().protest.count), { timeout: 30_000 * CI_SLOW }).toBeGreaterThan(0);
  const c = await page.evaluate(() => {
    const k = window.__squib!.controller.protestCases[0]!;
    return { kind: k.incident.kind, boats: k.incident.boats, frames: k.frames.length, first: k.frames[0]!.t, t: k.incident.t, open: k.open };
  });
  expect(c.kind).toBe('boat');
  expect(c.boats).toContain('you');
  expect(c.open).toBe(false);
  // Twenty seconds into the run: the clip starts at the first frame kept (up to 15 s before).
  expect(c.t - c.first).toBeGreaterThan(5);
  expect(c.frames).toBeGreaterThan(30);
  await page.evaluate(() => window.__squib!.controller.toggleProtestRoom(true));
  const room = page.getByTestId('protest-room');
  await expect(room).toBeVisible({ timeout: 30_000 * CI_SLOW });
  await expect(page.getByTestId('protest-summary')).toContainText(/Contact between/);
  await expect(room).toContainText(/simplified judge, not a protest hearing/);
  // Before the preparatory signal Part 2 did not apply: no rule note, and the summary says why.
  await expect(page.getByTestId('protest-summary')).toContainText(/before the preparatory signal|did not keep clear/);
  await page.getByTestId('protest-play').dispatchEvent('click');
  await expect(page.getByTestId('protest-play')).toHaveText(/Play|Watch again/);
  expect(errors).toEqual([]);
});

test('start drill: the line readouts before the gun, the start scored, and the same start again', async ({ page }) => {
  test.setTimeout(240_000 * CI_SLOW);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await ready(page);
  await page.evaluate(() => window.__squib!.controller.startDrill({ competitors: 0, level: 'good', venue: 'start-bay', course: 'short', conditions: 'random', wind: 'medium', seed: 5, sequence: 'one-minute' }));
  await page.evaluate(() => window.__squib!.controller.togglePause());
  const toStart = await page.evaluate(() => window.__squib!.controller.getState().race!.toStart);
  await page.evaluate((s) => window.__squib!.advance(s), toStart - 20);
  await expect(page.getByTestId('line-readouts')).toBeVisible({ timeout: 30_000 * CI_SLOW });
  await expect(page.getByTestId('line-distance')).toHaveText(/^\d+ m( over)?$/);
  await expect(page.getByTestId('line-bias')).toHaveText(/Line square to the wind|Favoured: (the committee boat|the pin end|.+), by .+ \(\d+°\)/);
  const line = await page.evaluate(() => window.__squib!.controller.getState().race!.line!);
  expect(line.readout.distanceM).toBeGreaterThan(0);
  await expect(page.getByTestId('drill')).toContainText('Start drill · start 1');
  // Past the gun: scored half a minute after it (or once started).
  await page.evaluate(() => window.__squib!.advance(55));
  await expect(page.getByTestId('drill-verdict')).toBeVisible({ timeout: 30_000 * CI_SLOW });
  const d = await page.evaluate(() => window.__squib!.controller.getState().race!.drill!);
  expect(d.history).toHaveLength(1);
  expect(Number.isFinite(d.last!.atGunM)).toBe(true);
  await page.getByTestId('drill-again').dispatchEvent('click');
  await expect(page.getByTestId('drill')).toContainText('Start drill · start 2', { timeout: 30_000 * CI_SLOW });
  expect(await page.evaluate(() => window.__squib!.controller.getState().race!.toStart)).toBeGreaterThan(50);
  expect(errors).toEqual([]);
});

/**
 * Owner item, 10 Nov 2026: the graphics check's report should be easy to send. The automatic check's result comes up
 * as a card once for each graphics card (and whenever it finds a fault), with the report to copy or save.
 */
test('graphics check card: the result once for this graphics card, with the report to save', async ({ page }) => {
  test.setTimeout(180_000 * CI_SLOW);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // `?gpucheck` runs the automatic check on the software renderer too.
  await page.goto('/?nowelcome&quality=low&gpucheck=1');
  const card = page.getByTestId('gpu-card');
  await expect(card).toBeVisible({ timeout: 90_000 * CI_SLOW });
  await expect(card).toContainText('Graphics check: painted surfaces draw correctly');
  const download = page.waitForEvent('download');
  await page.getByTestId('gpu-card-save').dispatchEvent('click');
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^squib-graphics-check-\d{4}-\d{2}-\d{2}\.txt$/);
  await page.getByTestId('gpu-card-close').dispatchEvent('click');
  await expect(card).toBeHidden();
  // Seen for this graphics card: not again, unless the check finds a fault.
  await page.goto('/?nowelcome&quality=low&gpucheck=1');
  await expect(page.getByTestId('stw')).toBeVisible();
  await page.waitForFunction(() => !!window.__squib!.controller.getState().materialCheck, null, { timeout: 90_000 * CI_SLOW });
  await expect(card).toBeHidden();
  await page.goto('/?nowelcome&quality=low&gpucheck=fault');
  await expect(card).toBeVisible({ timeout: 90_000 * CI_SLOW });
  await expect(card).toContainText('a fault was found and fixed');
  await expect(card).toContainText(/now drawing (without sky reflections|with simple materials)/);
  expect(errors).toEqual([]);
});
