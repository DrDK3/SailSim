import { expect, test, type Page } from '@playwright/test';

/** CI runners draw the scene in software, several times slower (playwright.config.ts). */
const CI_SLOW = process.env.CI ? 2 : 1;

/**
 * Comprehensive review, Package 2 (§8.4 accessibility checklist): dialogs keep the keyboard in and give focus
 * back (UX-2); controls are at least 24 × 24 CSS px and text at least 12 px (UX-3, WCAG 2.2 SC 2.5.8).
 */
async function ready(page: Page) {
  await page.goto('/?nowelcome');
  await expect(page.getByTestId('stw')).toBeVisible();
  await page.waitForFunction(() => window.__squib!.controller.getState().dart.status !== 'loading', null, { timeout: 60_000 * CI_SLOW });
}

test('a dialog keeps Tab inside, Escape closes it, and focus goes back to where it was', async ({ page }) => {
  test.setTimeout(120_000 * CI_SLOW);
  await ready(page);
  const help = page.getByRole('button', { name: 'Help' });
  await help.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Help' });
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press(i % 3 === 2 ? 'Shift+Tab' : 'Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
  }
  // The rest of the app cannot be reached while it is open.
  expect(await page.evaluate(() => (document.querySelector('.toolbar') as HTMLElement).closest('[inert]') !== null)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(help).toBeFocused();
  expect(await page.evaluate(() => document.querySelectorAll('[inert]').length)).toBe(0);
  // The sailing keys still work after the dialog has closed.
  const before = await page.evaluate(() => window.__squib!.controller.getState().snapshot.rudder);
  await page.keyboard.down('KeyD');
  await expect.poll(() => page.evaluate(() => window.__squib!.controller.getState().snapshot.rudder), { timeout: 20_000 * CI_SLOW }).not.toBe(before);
  await page.keyboard.up('KeyD');
});

test('controls are at least 24 px and text at least 12 px, sailing and racing, on a laptop and a phone', async ({ page }) => {
  test.setTimeout(240_000 * CI_SLOW);
  await ready(page);
  await page.evaluate(() => window.__squib!.controller.startQuickRace({ competitors: 2, level: 'good', venue: 'start-bay', course: 'windward-leeward', conditions: 'random', wind: 'any', seed: 3, sequence: 'one-minute' }));
  await expect(page.getByTestId('coach')).toBeVisible();
  const problems: string[] = [];
  for (const size of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    await page.waitForTimeout(1000);
    const found = await page.evaluate(() => {
      const out: string[] = [];
      const visible = (el: Element) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('[aria-hidden="true"]');
      };
      const name = (el: Element) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 24)}"`;
      for (const el of document.querySelectorAll('button, select, input, a[href], summary')) {
        if (!visible(el)) continue;
        // A checkbox or slider counts with its label (the label is part of the target).
        const target = el.matches('input[type=checkbox], input[type=radio], input[type=range]') ? (el.closest('label') ?? el) : el;
        const r = target.getBoundingClientRect();
        if (r.width < 23.5 || r.height < 23.5) out.push(`target ${name(el)} ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
      const walker = document.createTreeWalker(document.querySelector('.app')!, NodeFilter.SHOW_TEXT);
      const seen = new Set<Element>();
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        if (!el || seen.has(el) || !n.textContent?.trim() || !visible(el)) continue;
        seen.add(el);
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs < 11.95) out.push(`text ${name(el)} ${fs}px`);
      }
      return out;
    });
    for (const f of found) problems.push(`${size.width}×${size.height}: ${f}`);
  }
  expect(problems).toEqual([]);
});

/**
 * Decision D4 (review UX-8): the first visit asks "Have you sailed before?". A sailor gets tiller steering: A pushes
 * the tiller to port and the bow turns to starboard. The tiller picture follows the simulation either way, and the
 * choice is kept for the next visit.
 */
test.describe('first visit', () => {
  // A first-time visitor: nothing stored in the browser (playwright.config.ts marks the welcome as seen).
  test.use({ storageState: { cookies: [], origins: [] } });

test('a sailor chooses tiller steering, A turns the bow to starboard, and the choice is kept', async ({ page }) => {
  test.setTimeout(150_000 * CI_SLOW);
  await page.goto('/');
  const ask = page.getByTestId('steering-ask');
  await expect(ask).toBeVisible({ timeout: 60_000 * CI_SLOW });
  await expect(page.getByTestId('steer-bow')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('steer-tiller').click();
  await expect(page.getByTestId('steer-tiller')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Close and look around' }).click();
  await expect(page.getByTestId('stw')).toBeVisible();
  await expect(page.getByRole('button', { name: /Tiller to port, bow to starboard/ })).toBeVisible();
  await page.keyboard.down('KeyA');
  await page.evaluate(() => window.__squib!.advance(1));
  await page.keyboard.up('KeyA');
  // Positive rudder: the bow turns to starboard; the tiller lies to port.
  expect(await page.evaluate(() => window.__squib!.controller.getState().snapshot.rudder)).toBeGreaterThan(0.05);
  await expect(page.getByTestId('tiller')).toContainText(/to port · bow turning to starboard/);
  await page.reload();
  await expect(page.getByTestId('stw')).toBeVisible({ timeout: 60_000 * CI_SLOW });
  expect(await page.evaluate(() => window.__squib!.controller.getState().steering)).toBe('tiller');
});
});

/**
 * Review GR-4: with the reader's "reduce motion" setting the helm view keeps a level horizon (no roll) and the
 * camera does not ride the waves (under 1 cm of height change from frame to frame).
 */
test('reduced motion: a level horizon and no wave heave in the helm view', async ({ page }) => {
  test.setTimeout(180_000 * CI_SLOW);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  await page.evaluate(() => {
    const c = window.__squib!.controller;
    c.setGraphics({ ...c.getState().graphics!, preset: 'custom', resolutionScale: 0.5, maxPixelRatio: 1, water: 'low', spray: false, atmosphere: false });
    // A fresh breeze, so the boat heels and the sea has waves.
    c.restart({ ...c.scenario, startHeadingDeg: 135, startSpeedKn: 4, conditions: { ...c.scenario.conditions, weather: { source: 'manual', twsKn: 16, twdDeg: 225 } } });
    c.setCamera('helm');
    // Software rendering runs far slower than real time: sail on 20 s at once.
    window.__squib!.advance(20);
  });
  expect(await page.evaluate(() => Math.abs(window.__squib!.controller.getState().snapshot.heel))).toBeGreaterThan(0.05);
  const frames = await page.evaluate(
    () =>
      new Promise<{ rightY: number; y: number }[]>((resolve) => {
        const cam = (window.__squib!.controller as unknown as { view: { camera: { matrixWorld: { elements: number[] }; position: { y: number } } } }).view.camera;
        const out: { rightY: number; y: number }[] = [];
        const tick = () => {
          out.push({ rightY: cam.matrixWorld.elements[1]!, y: cam.position.y });
          if (out.length < 12) requestAnimationFrame(tick);
          else resolve(out);
        };
        requestAnimationFrame(tick);
      }),
  );
  for (const f of frames) expect(Math.abs(f.rightY)).toBeLessThan(1e-3);
  for (let i = 1; i < frames.length; i++) expect(Math.abs(frames[i]!.y - frames[i - 1]!.y)).toBeLessThan(0.01);
});
