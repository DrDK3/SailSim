import { expect, test } from '@playwright/test';

/**
 * Review #15 (20 Nov 2026): the helm view from the helm's own eye on the side deck, facing forward; the helm's head and
 * torso not drawn (hands, tiller and legs are); clear of the boom; the field of view in Settings. Fixed seed, steady
 * wind, both tacks, upwind and downwind: each view is checked by measurement and its screenshot kept with the results
 * (software rendering only: nothing here is judged by eye).
 */
const CI_SLOW = process.env.CI ? 2 : 1;
const WIND_FROM = 225;
const CASES = [
  { name: 'upwind, starboard tack', heading: WIND_FROM - 45, side: 1 },
  { name: 'upwind, port tack', heading: WIND_FROM + 45, side: -1 },
  { name: 'downwind, starboard tack', heading: WIND_FROM - 150, side: 1 },
  { name: 'downwind, port tack', heading: WIND_FROM + 150 - 360, side: -1 },
];

test('the helm view: at the helm’s eye on the windward deck, head and torso hidden, hands and legs drawn, both tacks up and downwind', async ({ page }, info) => {
  test.setTimeout(360_000 * CI_SLOW);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?nowelcome&conditions=set&quality=low');
  await expect(page.getByTestId('stw')).toBeVisible();
  await page.waitForFunction(() => window.__squib!.controller.getState().dart.status !== 'loading', null, { timeout: 60_000 * CI_SLOW });
  for (const c of CASES) {
    await page.evaluate(({ heading, wind }) => {
      const ctl = window.__squib!.controller;
      ctl.restart({
        conditions: { startTime: '2026-07-15T13:00:00Z', weather: { source: 'manual', twsKn: 10, twdDeg: wind }, gusts: { preset: 'steady', seed: 7 }, current: { mode: 'none' } },
        startLocation: 'start-bay-practice',
        startHeadingDeg: heading,
        startSpeedKn: 4,
      });
      ctl.setInput({ autoMain: true, autoJib: true, autoCrew: true });
      ctl.setCamera('helm');
      window.__squib!.advance(8);
    }, { heading: c.heading, wind: WIND_FROM });
    // A few frames, so the figure is posed and the camera placed for this boat.
    await page.evaluate(() => new Promise<void>((done) => { let i = 0; const f = () => (++i > 4 ? done() : requestAnimationFrame(f)); requestAnimationFrame(f); }));
    const m = await page.evaluate(() => {
      type V3 = { x: number; y: number; z: number };
      const view = (window.__squib!.controller as unknown as { view: { helmEyeLocal: V3; boat: { group: { getObjectByName(n: string): { visible: boolean; children: { name: string; position: V3; scale: V3 }[] } } } } }).view;
      const helm = view.boat.group.getObjectByName('crew-helm');
      const bone = (n: string) => helm.children.find((b) => b.name === n)!;
      const head = bone('head');
      const eye = view.helmEyeLocal;
      return {
        eye,
        headDist: Math.hypot(eye.x - head.position.x, eye.y - head.position.y, eye.z - head.position.z),
        visible: helm.visible,
        headScale: head.scale.x,
        chestScale: bone('chest').scale.x,
        handScale: Math.min(bone('handL').scale.x, bone('handR').scale.x),
        legScale: Math.min(bone('thighL').scale.x, bone('shinR').scale.x),
        mainSide: window.__squib!.controller.getState().snapshot.mainSide,
      };
    });
    await info.attach(`helm view, ${c.name}`, { body: await page.screenshot(), contentType: 'image/png' });
    // At the helm figure's head, on the windward side deck (the boom out to leeward), aft of the mast.
    expect(m.headDist, c.name).toBeLessThan(0.15);
    // On a side deck. Upwind on the windward one (mainSide 1 is the starboard tack, src/ui/Instruments.tsx: the wind
    // and the helm on the starboard side, x > 0); on a run the crew's weight, and so the helm, may sit to leeward.
    // On a run in this light wind the crew sit in the middle and the helm with them, low in the cockpit (the crew's
    // posing, src/render/squibModel.ts): the eye goes where the helm's head is.
    expect(Math.abs(m.eye.x), c.name).toBeLessThan(1.0);
    if (c.name.startsWith('upwind')) {
      expect(Math.abs(m.eye.x), `${c.name}: on a side deck`).toBeGreaterThan(0.45);
      expect(Math.sign(m.eye.x), `${c.name}: on the windward deck`).toBe(m.mainSide);
    }
    expect(m.eye.z, c.name).toBeGreaterThan(1.2);
    expect(m.eye.y, `${c.name}: a sitting helm's eye height`).toBeGreaterThan(0.6);
    // The figure is drawn, but not its head or chest; its hands and legs are.
    expect(m.visible).toBe(true);
    expect([m.headScale, m.chestScale]).toEqual([0, 0]);
    expect([m.handScale, m.legScale]).toEqual([1, 1]);
  }
  // Settings: the field of view.
  await page.evaluate(() => window.__squib!.controller.setPrefs({ helmFovDeg: 80 }));
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  expect(await page.evaluate(() => (window.__squib!.controller as unknown as { view: { helmView: { fov: number } } }).view.helmView.fov)).toBe(80);
  await page.evaluate(() => window.__squib!.controller.setPrefs({ helmFovDeg: 68 }));
  // Another view draws the whole helm.
  await page.evaluate(() => window.__squib!.controller.setCamera('chase'));
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  const chase = await page.evaluate(() => {
    const view = (window.__squib!.controller as unknown as { view: { boat: { group: { getObjectByName(n: string): { children: { name: string; scale: { x: number } }[] } } } } }).view;
    return view.boat.group.getObjectByName('crew-helm').children.find((b) => b.name === 'head')!.scale.x;
  });
  expect(chase).toBe(1);
  expect(errors).toEqual([]);
});
