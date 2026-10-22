import { expect, test, type Page } from '@playwright/test';
import { runDeterminismState } from '../../src/sim/testing/determinism';

type Snap = { t: number; heading: number; stw: number; rudder: number; mainSide: number };

const snap = (page: Page) => page.evaluate(() => window.__squib!.snapshot() as Snap);

async function open(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await expect(page.getByTestId('stw')).toBeVisible();
  return errors;
}

test('loads, renders a canvas, and the simulation runs without errors', async ({ page }) => {
  const errors = await open(page);
  await expect(page.locator('[data-testid="viewport"] canvas')).toBeVisible();
  const t0 = (await snap(page)).t;
  await expect.poll(async () => (await snap(page)).t, { timeout: 30_000 }).toBeGreaterThan(t0);
  await expect(page.getByText('Starboard tack')).toBeVisible();
  expect(errors).toEqual([]);
});

test('keyboard helm and sheet controls change the boat', async ({ page }) => {
  await open(page);
  const before = await snap(page);
  await page.keyboard.down('KeyD');
  await page.evaluate(() => window.__squib!.advance(2));
  const turning = await snap(page);
  await page.keyboard.up('KeyD');
  expect(turning.rudder).toBeGreaterThan(0.2); // helm to starboard
  const dHeading = Math.atan2(Math.sin(turning.heading - before.heading), Math.cos(turning.heading - before.heading));
  expect(dHeading).toBeGreaterThan(0.05); // bow turned to starboard

  const sheetBefore = await page.evaluate(() => window.__squib!.controller.sim.currentSheet('main'));
  await page.keyboard.down('KeyS');
  await page.evaluate(() => window.__squib!.advance(1));
  await page.keyboard.up('KeyS');
  const input = await page.evaluate(() => window.__squib!.input() as { autoMain: boolean; mainSheet: number });
  expect(input.autoMain).toBe(false);
  expect(input.mainSheet).toBeGreaterThan(sheetBefore);
});

test('on-screen buttons, pause, help and scenario panel work', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: /Steer to port/ }).dispatchEvent('pointerdown');
  await page.evaluate(() => window.__squib!.advance(1));
  expect((await snap(page)).rudder).toBeLessThan(-0.1);
  await page.getByRole('button', { name: /Steer to port/ }).dispatchEvent('pointerup');

  await page.getByTestId('pause').click();
  await expect(page.getByText('Paused (P to resume)')).toBeVisible();
  const tPaused = (await snap(page)).t;
  await page.waitForTimeout(1500);
  expect((await snap(page)).t).toBe(tPaused);
  await page.getByTestId('pause').click();

  await page.keyboard.press('KeyH');
  await expect(page.getByRole('dialog', { name: 'Help' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Help' })).toBeHidden();

  await page.getByRole('button', { name: 'Scenario' }).click();
  const tws = page.locator('.scenario .field').first().locator('input[type="number"]');
  await tws.fill('15');
  await page.getByRole('button', { name: 'Apply and restart' }).click();
  await expect(page.locator('footer.badge')).toContainText('wind 15 kn');
  expect((await snap(page)).t).toBeLessThan(5);
});

test('criterion 11: reproducible in the browser, and within tolerance of Node', async ({ page }) => {
  await open(page);
  // Same engine: bit-identical.
  const [h1, h2] = await page.evaluate(() => [window.__squib!.determinism(600), window.__squib!.determinism(600)]);
  expect(h1).toBe(h2);
  // Across engines (Node's V8 vs Chromium's V8): Math.sin/cos/pow can differ in the last bit, so compare
  // every state component within 1e-6 (metres, m/s, radians). Measured difference is ~1e-13.
  const node = runDeterminismState(600);
  const browser = await page.evaluate(() => window.__squib!.determinismState(600));
  expect(browser.length).toBe(node.length);
  const maxDiff = Math.max(...node.map((v, i) => Math.abs(v - browser[i]!)));
  console.log(`[criterion 11] max |Node - Chromium| state difference after 600 s: ${maxDiff.toExponential(2)}`);
  expect(maxDiff).toBeLessThan(1e-6);
});

test('without WebGL the app explains the problem and keeps the instruments live', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      if (type.startsWith('webgl')) return null;
      return (orig as (...a: unknown[]) => unknown).call(this, type, ...args);
    } as typeof orig;
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('3D view unavailable');
  const t0 = (await snap(page)).t;
  await expect.poll(async () => (await snap(page)).t, { timeout: 15_000 }).toBeGreaterThan(t0 + 1);
});
