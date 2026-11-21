import { expect, test, type Page } from '@playwright/test';

/**
 * Next round, packages A2, A4 and A5 (review #9, #16–#24, 20 Nov 2026), in the browser: the river arriving during a
 * lesson asks before restarting; the sail status's colour agrees with its words; plain words at Learn; the crew shown
 * trimming; VMG up or down the wind; phones get a compact instrument strip and 44 px sailing controls.
 */
const CI_SLOW = process.env.CI ? 2 : 1;

async function ready(page: Page, url = '/?nowelcome&conditions=set&quality=low') {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await expect(page.getByTestId('stw')).toBeVisible();
  return errors;
}

test('the river arriving during a lesson asks first; Keep sailing goes on, Restart starts the lesson again with the river', async ({ page }) => {
  test.setTimeout(240_000 * CI_SLOW);
  // Hold the River Dart's files back until the lesson is under way (a slow connection).
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.route('**/geo/manifest.json', async (route) => {
    await gate;
    await route.continue();
  });
  const errors = await ready(page);
  await page.evaluate(() => window.__squib!.controller.startLesson());
  await page.keyboard.down('KeyA');
  await page.evaluate(() => window.__squib!.advance(2));
  await page.keyboard.up('KeyA');
  await page.evaluate(() => window.__squib!.advance(4));
  const before = await page.evaluate(() => ({ t: window.__squib!.controller.sim.time, lesson: window.__squib!.controller.getState().tutorial?.lesson.id }));
  expect(before.t).toBeGreaterThan(5);
  release();
  const card = page.getByTestId('river-card');
  await expect(card).toBeVisible({ timeout: 120_000 * CI_SLOW });
  await expect(card).toContainText('The river is ready. Restart here?');
  await expect(card).toContainText('this lesson');
  // Nothing was reset: the same lesson, the clock running on.
  const now = await page.evaluate(() => ({ t: window.__squib!.controller.sim.time, lesson: window.__squib!.controller.getState().tutorial?.lesson.id, status: window.__squib!.controller.getState().dart.status }));
  expect(now.lesson).toBe(before.lesson);
  expect(now.t).toBeGreaterThanOrEqual(before.t);
  expect(now.status).toBe('ready');
  await card.getByRole('button', { name: 'Keep sailing' }).click();
  await expect(card).toHaveCount(0);
  expect(await page.evaluate(() => window.__squib!.controller.sim.time)).toBeGreaterThanOrEqual(now.t);
  // The next start takes the river.
  await page.evaluate(() => window.__squib!.controller.restart());
  await expect.poll(() => page.evaluate(() => window.__squib!.controller.getState().dart.status)).toBe('loaded');
  expect(await page.evaluate(() => !!window.__squib!.controller.sim.seabed)).toBe(true);
  expect(errors).toEqual([]);
});

test('sail status: colour and words agree; plain words at Learn; the crew trimming shown on the sheet', async ({ page }) => {
  test.setTimeout(180_000 * CI_SLOW);
  const errors = await ready(page);
  // A run, the main eased right out with auto-trim on: neutral, "Eased right out", never "Stalled" in green.
  await page.evaluate(() => {
    const c = window.__squib!.controller;
    c.restart({ ...c.scenario, startLocation: 'start-bay-practice', startHeadingDeg: (225 + 175) % 360, conditions: { ...c.scenario.conditions, weather: { source: 'manual', twsKn: 10, twdDeg: 225 }, gusts: { preset: 'steady', seed: 3 }, current: { mode: 'none' } } });
    c.setInput({ autoMain: true, autoJib: true });
    window.__squib!.advance(15);
  });
  const status = page.getByTestId('main-status');
  await expect(status).toBeVisible();
  const cls = await status.getAttribute('class');
  const text = (await status.textContent()) ?? '';
  // Whatever the state, green means Drawing and the neutral grey means eased right out.
  if (cls?.includes('good')) expect(text).toContain('Drawing');
  if (cls?.includes('neutral')) expect(text).toContain('Eased right out');
  if (text.includes('Stalled')) expect(cls).not.toContain('good');
  // Auto-trim shown at work: the toggle reads "Crew", its name stays "Auto-trim".
  await expect(page.getByTestId('main-crew')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Auto-trim, main' })).toBeChecked();
  // VMG down the wind, a positive number.
  await expect(page.locator('.panel.instruments')).toContainText('VMG downwind');
  // Learn: plain words in the status and the instruments.
  await page.evaluate(() => window.__squib!.controller.setLevel('learn'));
  await expect(page.locator('.panel.instruments')).toContainText('Wind from');
  await expect(page.locator('.panel.instruments')).not.toContainText('TWA');
  const plain = (await status.textContent()) ?? '';
  expect(plain).toMatch(/Full|Flapping|Pulled in too far|Let right out|Wind behind the sail/);
  expect(plain).not.toMatch(/Luffing|Stalled|By the lee/);
  await page.evaluate(() => window.__squib!.controller.setLevel('club'));
  await expect(page.locator('.panel.instruments')).toContainText('TWA');
  expect(errors).toEqual([]);
});

for (const size of [
  { width: 390, height: 844, name: 'upright' },
  { width: 844, height: 390, name: 'on its side' },
]) {
  test.describe(`a phone ${size.name} (${size.width}×${size.height})`, () => {
    test.use({ viewport: { width: size.width, height: size.height }, hasTouch: true, isMobile: true });

    test('every sailing control at least 44 × 44 px; the instruments a compact strip, so more of the water shows', async ({ page }) => {
      test.setTimeout(150_000 * CI_SLOW);
      const errors = await ready(page);
      const m = await page.evaluate(() => {
        const small: string[] = [];
        for (const el of document.querySelectorAll<HTMLElement>('.panel.dock.console button, .panel.dock.console label.toggle')) {
          const b = el.getBoundingClientRect();
          if (b.width === 0) continue;
          if (b.width < 44 || b.height < 44) small.push(`${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 20)} ${Math.round(b.width)}×${Math.round(b.height)}`);
        }
        const instr = document.querySelector('.panel.instruments')!.getBoundingClientRect();
        const dock = document.querySelector('.panel.dock.console')!.getBoundingClientRect();
        return { small, instrH: instr.height, gap: dock.top - instr.bottom, dockBottom: dock.bottom, H: innerHeight, W: innerWidth, dockRight: dock.right };
      });
      expect(m.small).toEqual([]);
      // The strip: under 180 px tall (it was 250); the console inside the screen.
      expect(m.instrH).toBeLessThan(180);
      expect(m.dockBottom).toBeLessThanOrEqual(m.H);
      expect(m.dockRight).toBeLessThanOrEqual(m.W);
      // The water between them: at least 100 px on its side, 400 px upright (it was 363 px upright before).
      expect(m.gap).toBeGreaterThan(size.height > size.width ? 400 : 100);
      expect(errors).toEqual([]);
    });
  });
}
