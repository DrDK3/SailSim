import { expect, test, type Page } from '@playwright/test';

/** CI runners draw the scene in software, several times slower (playwright.config.ts). */
const CI_SLOW = process.env.CI ? 2 : 1;

/** The hi-fi pass: Squib types, the RDYC burgee and transom, river traffic, waves from the sea state. */

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

type SceneObj = { name: string; type?: string; visible: boolean; rotation: { y: number }; material?: { map?: unknown }; parent?: SceneObj; traverse: (f: (o: SceneObj) => void) => void };
type View = { scene: SceneObj; boat: { type: string; group: SceneObj } };

test('the Scenario panel offers the three Squib types; choosing one rebuilds the boat with its physics', async ({ page }) => {
  test.setTimeout(120_000 * CI_SLOW);
  const errors = await ready(page);
  await page.getByRole('button', { name: 'Scenario', exact: true }).click();
  const select = page.getByTestId('boat-type');
  await expect(select.locator('option')).toHaveText([
    'Rondar Squib (the modern standard)',
    'Classic Parker or Hunter hull (the traditional fleet)',
    'New sail package (Hyde B3 / Batt designs)',
  ]);
  await select.selectOption('classic');
  await expect(page.getByText(/not self-draining/)).toBeVisible();
  await page.getByText(/What changes/).click();
  await expect(page.getByText('cockpit.selfDraining')).toBeVisible();
  await page.getByRole('button', { name: 'Apply and restart' }).click();
  const r = await page.evaluate(() => {
    const c = window.__squib!.controller as unknown as { view: View; scenario: { boat?: string }; sim: { params: { cockpit: { selfDraining: boolean }; mass: number } } };
    return { type: c.view.boat.type, scenarioBoat: c.scenario.boat, selfDraining: c.sim.params.cockpit.selfDraining, mass: c.sim.params.mass };
  });
  expect(r.type).toBe('classic');
  expect(r.scenarioBoat).toBe('classic');
  expect(r.selfDraining).toBe(false);
  expect(r.mass).toBeCloseTo(680 + 15 + 160, 6);
  expect(errors).toEqual([]);
});

test('the boat flies the RDYC burgee, streaming with the apparent wind, and carries RDYC on its transom', async ({ page }) => {
  const errors = await ready(page);
  await page.evaluate(() => {
    const c = window.__squib!.controller;
    if (!c.getState().paused) c.togglePause();
  });
  const r = await page.evaluate(() => {
    const c = window.__squib!.controller as unknown as { view: View; sim: { snapshot: () => { awa: number } } };
    let flag: SceneObj | undefined;
    let transom: SceneObj | undefined;
    c.view.boat.group.traverse((o) => {
      if (o.name === 'burgee-flag') flag = o;
      if (o.name === 'hull-transom') transom = o;
    });
    const awa = c.sim.snapshot().awa;
    return { flagY: flag?.rotation.y, awa, transomTextured: !!transom?.material?.map, flagVisible: flag?.visible };
  });
  expect(r.flagVisible).toBe(true);
  expect(r.transomTextured).toBe(true);
  // The flag points away from where the apparent wind comes from: local +x turned to (−sin awa, cos awa) in xz.
  const expected = Math.atan2(-Math.cos(r.awa), -Math.sin(r.awa));
  expect(Math.abs(Math.atan2(Math.sin(r.flagY! - expected), Math.cos(r.flagY! - expected)))).toBeLessThan(1e-6);
  expect(errors).toEqual([]);
});

test('river traffic: the Lower Ferry and its tug, the Higher Ferry and Dart Marina boats are in the scene', async ({ page }) => {
  test.setTimeout(120_000 * CI_SLOW);
  const errors = await ready(page);
  const r = await page.evaluate(() => {
    const c = window.__squib!.controller;
    // A July morning (10:00 BST) with the stream running.
    c.restart({ ...c.scenario, conditions: { ...c.scenario.conditions, startTime: '2026-07-15T09:00:00Z',
      tide: { mode: 'manual', hwTime: '2026-07-15T12:00:00Z', hwHeightM: 4.8, lwHeightM: 0.9 },
      current: { mode: 'dart', stream: { floodSetDeg: 0, peakFloodKn: 1.5, peakEbbKn: 2, riverEbbKn: 0 } } } });
    if (!c.getState().paused) c.togglePause();
    window.__squib!.advance(1);
    const states = (c as unknown as { traffic: { states: (ms: number) => { kind: string; name: string }[] } }).traffic.states(Date.parse('2026-07-15T09:00:01Z'));
    return { kinds: [...new Set(states.map((s) => s.kind))], marina: states.filter((s) => s.name === 'Dart Marina').length };
  });
  expect(r.kinds).toContain('tug-float');
  expect(r.kinds).toContain('floating-bridge');
  // Let the renderer draw the traffic, then look for the models.
  await page.waitForTimeout(1500);
  const names = await page.evaluate(() => {
    const v = (window.__squib!.controller as unknown as { view: View }).view;
    const found = new Set<string>();
    v.scene.traverse((o) => {
      if (o.name.startsWith('vessel-') || o.name === 'tug') found.add(o.name);
    });
    return [...found];
  });
  expect(names).toContain('vessel-tug-float');
  expect(names).toContain('tug');
  expect(names).toContain('vessel-floating-bridge');
  expect(errors).toEqual([]);
});

test('wind against tide: the conditions report short, steep waves in the entrance on the ebb', async ({ page }) => {
  test.setTimeout(120_000 * CI_SLOW);
  await ready(page);
  await page.evaluate(() => {
    const c = window.__squib!.controller;
    c.restart({ ...c.scenario, startLocation: 'entrance', startHeadingDeg: 170, conditions: { startTime: '2026-07-15T15:06:00Z',
      weather: { source: 'manual', twsKn: 18, twdDeg: 180 }, gusts: { preset: 'steady', seed: 1 },
      tide: { mode: 'manual', hwTime: '2026-07-15T12:00:00Z', hwHeightM: 4.8, lwHeightM: 0.9 },
      current: { mode: 'dart', stream: { floodSetDeg: 0, peakFloodKn: 1.5, peakEbbKn: 2, riverEbbKn: 0 } } } });
    if (!c.getState().paused) c.togglePause();
    window.__squib!.advance(2);
  });
  const more = page.getByRole('button', { name: 'More instruments and conditions' });
  if (await more.isVisible()) await more.click();
  await expect(page.getByTestId('waves')).toContainText(/steepness ×/);
  await expect(page.getByText(/Wind against tide/)).toBeVisible();
});
