import { expect, test, type Page } from '@playwright/test';

/**
 * Crash and damage (owner, 6 Nov 2026: "from rig damage to visible hull damage, to water ingress, to sinking"):
 * marks drawn on the hull where it was struck, the report of what is coming in, the crew stuffing a hole, the
 * rig down and lying in the water, the hull lower as she fills, awash on her buoyancy tanks, and sunk.
 */

const CI_SLOW = process.env.CI ? 2 : 1;

interface View {
  boatRoot: { position: { y: number } };
  boat: { damageView?: { decals: { children: { name: string }[] }; wreck: { children: { name: string }[] }; version: number; t: { rig: { name: string; visible: boolean }[] } } };
}
type Sim = { impact: (what: string, region: string, speed: number, energy: number, at?: { x: number; y: number; z: number }) => unknown; damage: { version: number; state: string; breaches: { plugged: number; compartment: string }[] } };

async function ready(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?nowelcome&quality=low');
  await expect(page.getByTestId('stw')).toBeVisible();
  await page.waitForFunction(() => window.__squib!.controller.getState().dart.status !== 'loading', null, { timeout: 60_000 * CI_SLOW });
  return errors;
}

const hit = (page: Page, region: string, energy: number, at: { x: number; y: number; z: number }) =>
  page.evaluate(([region, energy, at]) => {
    const c = window.__squib!.controller;
    const sim = (c as unknown as { sim: Sim }).sim;
    sim.impact('test', region, 3, energy, at);
    // The report reads the published state: publish now (under load the next frame can be seconds away).
    c.setInput({});
    return sim.damage.version;
  }, [region, energy, at] as const);

/** The view has drawn this damage (its version). */
const drawn = (page: Page, version: number) =>
  page.waitForFunction((v) => ((window.__squib!.controller as unknown as { view: View }).view.boat.damageView?.version ?? -1) >= v, version, { timeout: 60_000 * CI_SLOW });

test('a crack and a hole drawn where she was struck; the report says what is coming in; the crew stuff the hole', async ({ page }) => {
  test.setTimeout(180_000 * CI_SLOW);
  const errors = await ready(page);
  await hit(page, 'side', 2000, { x: 0.3, y: 1, z: 0.1 });
  const v = await hit(page, 'bow', 6000, { x: 2.3, y: 0.5, z: 0.3 });
  await drawn(page, v);
  const marks = await page.evaluate(() => (window.__squib!.controller as unknown as { view: View }).view.boat.damageView!.decals.children.map((c) => c.name));
  expect(marks).toContain('scar-crack');
  expect(marks).toContain('scar-hole');
  const card = page.getByTestId('damage-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Hole, starboard bow below the waterline into the forward tank');
  await expect(card).toContainText('L/min');
  await expect(page.getByTestId('damage-state')).toHaveText('Taking on water');
  // The crack is in the main hull, within reach: stuffing it takes them about 20 s.
  await card.getByRole('button', { name: 'Stuff the hole' }).click();
  await expect(card.getByRole('button', { name: /Stuffing a sail bag in/ })).toBeDisabled();
  await page.evaluate(() => window.__squib!.advance(25));
  const plugged = await page.evaluate(() => (window.__squib!.controller as unknown as { sim: Sim }).sim.damage.breaches.filter((b) => b.compartment === 'main').map((b) => b.plugged));
  expect(plugged[0]).toBeGreaterThan(0.5);
  await expect(card).toContainText('stuffed');
  expect(errors).toEqual([]);
});

test('dismasted: the spars and sails come down and lie over the stern; the report says so', async ({ page }) => {
  test.setTimeout(150_000 * CI_SLOW);
  const errors = await ready(page);
  const v = await hit(page, 'bow', 14000, { x: 2.8, y: 0, z: 0.4 });
  await drawn(page, v);
  const look = await page.evaluate(() => {
    const dv = (window.__squib!.controller as unknown as { view: View }).view.boat.damageView!;
    return { wreck: dv.wreck.children.map((c) => c.name), standing: dv.t.rig.filter((o) => o.visible).map((o) => o.name) };
  });
  expect(look.wreck).toEqual(expect.arrayContaining(['mast-stump', 'mast-fallen', 'sails-down', 'boom-down']));
  expect(look.standing).toEqual([]);
  await expect(page.getByTestId('damage-card')).toContainText('dismasted: the mast fell aft');
  expect(errors).toEqual([]);
});

test('holed in the main hull she fills and floats awash on her tanks; a forward tank flooded as well and she sinks', async ({ page }) => {
  test.setTimeout(180_000 * CI_SLOW);
  const errors = await ready(page);
  const y0 = await page.evaluate(() => (window.__squib!.controller as unknown as { view: View }).view.boatRoot.position.y);
  await hit(page, 'side', 16000, { x: -0.5, y: -1, z: 0.05 });
  await page.evaluate(() => window.__squib!.advance(240));
  await expect(page.getByTestId('damage-state')).toHaveText('Awash');
  await expect(page.getByTestId('damage-banner')).toContainText('Awash: her buoyancy tanks keep her afloat');
  // Drawn lower in the water.
  await expect.poll(() => page.evaluate(() => (window.__squib!.controller as unknown as { view: View }).view.boatRoot.position.y), { timeout: 30_000 * CI_SLOW }).toBeLessThan(y0 - 0.3);
  await hit(page, 'bow', 6000, { x: 2.3, y: 0.4, z: 0.3 });
  await page.evaluate(() => window.__squib!.advance(240));
  await expect(page.getByTestId('damage-state')).toHaveText('Sunk');
  await expect(page.getByTestId('damage-banner')).toContainText('Sunk: she lies on the bottom');
  await page.getByTestId('damage-banner').getByRole('button', { name: 'Start again' }).click();
  await expect(page.getByTestId('damage-card')).toBeHidden({ timeout: 30_000 * CI_SLOW });
  expect(errors).toEqual([]);
});
