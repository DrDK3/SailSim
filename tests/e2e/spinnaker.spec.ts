import { expect, test, type Page } from '@playwright/test';

/**
 * Package B (20 Nov 2026 review, decisions D2/D3): the spinnaker in the browser. Called with O (or Hoist), the crew
 * hoist it; it fills on a run; over-eased by hand it collapses and flogs; the pole is gybed (I); dropped it is gone.
 * Each state is checked by the physics' state and its words (the text alternative), and its picture kept with the
 * results (software rendering only: nothing is judged by eye). It is drawn at every graphics preset, on the other
 * boats too; a lesson has none. Driven with __squib.advance, not wall-clock waits.
 */
const CI_SLOW = process.env.CI ? 2 : 1;

async function ready(page: Page, url = '/?nowelcome&conditions=set&quality=low') {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await expect(page.getByTestId('stw')).toBeVisible();
  await page.waitForFunction(() => window.__squib!.controller.getState().dart.status !== 'loading', null, { timeout: 90_000 * CI_SLOW });
  return errors;
}

const frames = (page: Page, n = 3) => page.evaluate((n) => new Promise<void>((done) => { let i = 0; const f = () => (++i > n ? done() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const spin = (page: Page) => page.evaluate(() => window.__squib!.controller.getState().snapshot.spin);

test('hoisted, full, collapsed, pole gybed, dropped: the physics, the words and the picture agree', async ({ page }, info) => {
  test.setTimeout(420_000 * CI_SLOW);
  const errors = await ready(page);
  // Free sailing at Club carries the spinnaker. A run in 10 kn, steady wind.
  await page.evaluate(() => {
    const c = window.__squib!.controller;
    c.setLevel('club');
    c.restart({
      conditions: { startTime: '2026-07-15T13:00:00Z', weather: { source: 'manual', twsKn: 10, twdDeg: 225 }, gusts: { preset: 'steady', seed: 7 }, current: { mode: 'none' } },
      startLocation: 'start-bay-practice',
      startHeadingDeg: 70,
      startSpeedKn: 4,
      spinnaker: true,
    });
    c.setInput({ autoMain: true, autoJib: true, autoCrew: true });
    window.__squib!.advance(4);
  });
  const call = page.getByTestId('spin-call');
  await expect(call).toBeVisible();
  await expect(call).toHaveAttribute('aria-pressed', 'false');
  expect((await spin(page))!.phase).toBe('down');
  // O: the crew hoist it.
  await page.keyboard.press('KeyO');
  await page.evaluate(() => window.__squib!.advance(3));
  expect((await spin(page))!.phase).toBe('hoisting');
  await expect(page.getByTestId('spin-status')).toContainText('Hoisting the spinnaker');
  await frames(page);
  await info.attach('spinnaker: hoisting', { body: await page.screenshot(), contentType: 'image/png' });
  await page.evaluate(() => window.__squib!.advance(15));
  const up = (await spin(page))!;
  expect(up.phase).toBe('up');
  expect(up.fill).toBeGreaterThan(0.9);
  await expect(call).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('spin-status')).toContainText('Spinnaker drawing');
  await frames(page);
  expect((await page.evaluate(() => window.__squib!.controller.cueAudit()))!.spinnaker).toBe(true);
  await info.attach('spinnaker: full', { body: await page.screenshot(), contentType: 'image/png' });
  // Eased right out by hand: it curls and collapses (the words say why).
  await page.evaluate(() => {
    window.__squib!.controller.setSpinnakerTrim(false, 1);
    window.__squib!.advance(4);
  });
  expect((await spin(page))!.fill).toBeLessThan(0.3);
  await expect(page.getByTestId('spin-status')).toContainText('collapsed');
  await expect(page.getByTestId('spin-status')).toContainText('eased too far');
  await frames(page);
  await info.attach('spinnaker: collapsed and flogging', { body: await page.screenshot(), contentType: 'image/png' });
  // The crew trim it again; then gybe the pole (I).
  await page.evaluate(() => {
    window.__squib!.controller.setSpinnakerTrim(true);
    window.__squib!.advance(6);
  });
  const before = (await spin(page))!.poleSide;
  await page.keyboard.press('KeyI');
  await page.evaluate(() => window.__squib!.advance(2));
  expect((await spin(page))!.phase).toBe('gybing');
  await expect(page.getByTestId('spin-status')).toContainText('Gybing the pole');
  await frames(page);
  await info.attach('spinnaker: gybing the pole', { body: await page.screenshot(), contentType: 'image/png' });
  await page.evaluate(() => window.__squib!.advance(10));
  expect((await spin(page))!.poleSide).toBe(-before);
  // Drop it (O): down in seconds, not drawn.
  await page.evaluate(() => window.__squib!.advance(20));
  await page.keyboard.press('KeyO');
  await page.evaluate(() => window.__squib!.advance(3));
  expect((await spin(page))!.phase).toBe('dropping');
  await frames(page);
  await info.attach('spinnaker: dropping', { body: await page.screenshot(), contentType: 'image/png' });
  await page.evaluate(() => window.__squib!.advance(10));
  expect((await spin(page))!.phase).toBe('down');
  await frames(page);
  expect((await page.evaluate(() => window.__squib!.controller.cueAudit()))!.spinnaker).toBe(false);
  expect(errors).toEqual([]);
});

test('a race: the spinnaker drawn at every graphics preset, the AI boats hoisting theirs on the run; a lesson has none', async ({ page }) => {
  test.setTimeout(480_000 * CI_SLOW);
  const errors = await ready(page, '/?nowelcome&quality=low');
  // Three AI boats on a short windward-leeward race; sail on until they are on the run.
  await page.evaluate(() => {
    const c = window.__squib!.controller;
    c.startQuickRace({ competitors: 3, level: 'good', venue: 'start-bay', course: 'short', conditions: 'random', wind: 'any', seed: 3, sequence: 'one-minute' });
    c.setInput({ autoMain: true, autoJib: true, autoCrew: true });
    c.callSpinnaker(true);
  });
  await page.waitForFunction(() => {
    window.__squib!.advance(20);
    const ai = (window.__squib!.controller as unknown as { race?: { session: { fleet: { boats: { kind: string; sim: { spin: { phase: string } } }[] } } } }).race!.session.fleet.boats.filter((b) => b.kind === 'ai');
    return ai.some((b) => b.sim.spin.phase === 'up') || window.__squib!.controller.sim.time > 900;
  }, null, { timeout: 240_000 * CI_SLOW, polling: 2000 });
  const aiUp = await page.evaluate(() => (window.__squib!.controller as unknown as { race: { session: { fleet: { boats: { kind: string; sim: { spin: { phase: string } } }[] } } } }).race.session.fleet.boats.filter((b) => b.kind === 'ai' && b.sim.spin.phase === 'up').length);
  expect(aiUp, 'an AI boat with its spinnaker up').toBeGreaterThan(0);
  for (const label of ['Smooth', 'Balanced', 'Ultra']) {
    await page.evaluate(() => window.__squib!.controller.toggleSettings(true));
    await page.getByRole('radio', { name: label, exact: true }).click();
    await page.evaluate(() => window.__squib!.controller.toggleSettings(false));
    await frames(page, 3);
    const a = (await page.evaluate(() => window.__squib!.controller.cueAudit()))!;
    expect(a.otherSpinnakers, `${label}: the AI boats' spinnakers`).toBeGreaterThan(0);
  }
  // A lesson: no spinnaker, no button.
  await page.evaluate(() => window.__squib!.controller.startLesson('steer'));
  await expect(page.getByTestId('spin-call')).toHaveCount(0);
  expect(await page.evaluate(() => window.__squib!.controller.carriesSpinnaker)).toBe(false);
  expect(errors).toEqual([]);
});
