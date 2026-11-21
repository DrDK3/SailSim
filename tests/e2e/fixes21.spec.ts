import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { EASED_LABEL, PLAIN_LABEL, STATE_LABEL } from '../../src/app/sailStatus';

/**
 * Fixes of 21 Nov 2026 (docs/FIXES_21NOV_REPORT.md), in the browser.
 * §2.4: on a phone upright the sails' state words were cut off ("Luf…", "Dra…" at 390 px). Now, at 360, 390 and 430 px
 * and at every level, every state's words show in full, every sailing control is at least 44 px, and the 3D view keeps
 * at least half the screen's height. At Learn the wind is in words, the angle small alongside.
 */
const CI_SLOW = process.env.CI ? 2 : 1;

async function ready(page: Page, url = '/?nowelcome&conditions=set&quality=low') {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await expect(page.getByTestId('stw')).toBeVisible({ timeout: 90_000 * CI_SLOW });
  await expect(page.getByTestId('main-status')).toBeVisible();
  // The River Dart data loaded (until then its arrival can change the screen under a click).
  await page.waitForFunction(() => window.__squib!.controller.getState().dart.status !== 'loading', null, { timeout: 120_000 * CI_SLOW });
  return errors;
}

/** Every words a sail's state pill can show, at any level. */
const STATE_WORDS = [...Object.values(STATE_LABEL), EASED_LABEL, ...Object.values(PLAIN_LABEL)];

for (const size of [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
]) {
  test.describe(`§2.4: a phone upright, ${size.width}×${size.height}`, () => {
    test.use({ viewport: size, hasTouch: true, isMobile: true });

    test('every state’s words in full at every level, controls at least 44 px, half the screen for the view', async ({ page }) => {
      test.setTimeout(240_000 * CI_SLOW);
      const errors = await ready(page);
      for (const level of ['learn', 'club', 'expert'] as const) {
        await page.evaluate((l) => window.__squib!.controller.setLevel(l), level);
        // The pills as the app renders them now: nothing cut off.
        await expect(page.getByTestId('main-status')).toBeVisible();
        const m = await page.evaluate((words) => {
          const c = window.__squib!.controller;
          if (!c.getState().paused) c.togglePause();
          const cut: string[] = [];
          // Each word the pill can show, in each pill, measured where the app lays it out (set and measured at once,
          // so no render comes between).
          for (const sail of ['main', 'jib']) {
            const strong = document.querySelector(`[data-testid="${sail}-status"] strong`) as HTMLElement;
            const was = strong.textContent;
            for (const w of words) {
              strong.textContent = w;
              if (strong.scrollWidth > strong.clientWidth + 0.5 || strong.scrollHeight > strong.clientHeight + 0.5) cut.push(`${sail}: ${w} (${strong.scrollWidth}>${strong.clientWidth})`);
            }
            strong.textContent = was;
          }
          const small: string[] = [];
          for (const el of document.querySelectorAll<HTMLElement>('.panel.dock.console button, .panel.dock.console label.toggle')) {
            const b = el.getBoundingClientRect();
            if (b.width === 0) continue;
            if (b.width < 44 || b.height < 44) small.push(`${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 20)} ${Math.round(b.width)}×${Math.round(b.height)}`);
          }
          const dock = document.querySelector('.panel.dock.console')!.getBoundingClientRect();
          const bar = document.querySelector('.toolbar')!.getBoundingClientRect();
          const instr = document.querySelector('.panel.instruments')!.getBoundingClientRect();
          c.togglePause();
          return { cut, small, view: dock.top - bar.bottom, instrBottom: instr.bottom, dockTop: dock.top, dockBottom: dock.bottom, H: innerHeight };
        }, STATE_WORDS);
        expect(m.cut, level).toEqual([]);
        expect(m.small, level).toEqual([]);
        expect(m.dockBottom, level).toBeLessThanOrEqual(m.H);
        // The view between the top bar and the console: at least half the screen's height.
        expect(m.view / m.H, level).toBeGreaterThanOrEqual(0.5);
        // The instruments a compact strip at every level on a phone (Expert opened them all over the water before).
        expect(m.instrBottom, level).toBeLessThan(m.dockTop - 200);
      }
      expect(errors).toEqual([]);
    });
  });
}

test('§2.4: at Learn the wind is in words, the angle small alongside; at Club the sailors’ TWA', async ({ page }) => {
  test.setTimeout(150_000 * CI_SLOW);
  const errors = await ready(page);
  await page.evaluate(() => window.__squib!.controller.setLevel('learn'));
  const cell = page.locator('[data-cell="twa"]');
  await expect(cell.locator('.cell-label')).toHaveText('Wind');
  await expect(cell.locator('.cell-value')).toHaveText(/^from (dead ahead|dead behind|ahead|behind|your (left|right) side)/);
  await expect(cell.locator('.unit')).toHaveText(/^\(\d{1,3}°\)$/);
  await page.evaluate(() => window.__squib!.controller.setLevel('club'));
  await expect(cell.locator('.cell-label')).toHaveText('TWA');
  await expect(cell.locator('.cell-value')).toHaveText(/^\d{1,3}°( stbd| port)?$/);
  expect(errors).toEqual([]);
});

test('§3.1: Settings → Advanced, five switches (axe-clean); plain words off gives Learn the Club words', async ({ page }) => {
  test.setTimeout(180_000 * CI_SLOW);
  const errors = await ready(page);
  await page.evaluate(() => window.__squib!.controller.toggleSettings(true));
  await expect(page.getByTestId('settings-panel')).toBeVisible({ timeout: 30_000 * CI_SLOW });
  const flags = page.getByTestId('feature-flags');
  await flags.scrollIntoViewIfNeeded();
  await expect(flags.getByRole('checkbox')).toHaveCount(5);
  for (const f of ['spinnaker', 'riverHotSwap', 'plainLanguage', 'learnMap']) await expect(page.getByTestId(`flag-${f}`)).toBeChecked();
  await expect(page.getByTestId('flag-markRoomPenalties')).not.toBeChecked();
  const axe = await new AxeBuilder({ page }).include('[data-testid="feature-flags"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  // Text at least 12 px.
  expect(await flags.evaluate((el) => Math.min(...[...el.querySelectorAll('span, p')].map((n) => parseFloat(getComputedStyle(n).fontSize))))).toBeGreaterThanOrEqual(12);
  // The switch clicked as a person would (the input's own click, so its handler runs), inside the scrolling panel.
  await page.evaluate(() => (document.querySelector('[data-testid="flag-plainLanguage"]') as HTMLInputElement).click());
  await expect(page.getByTestId('flag-plainLanguage')).not.toBeChecked();
  await page.evaluate(() => window.__squib!.controller.toggleSettings(false));
  await expect(page.getByTestId('settings-panel')).toBeHidden();
  // Plain words off: Learn shows the sailors' terms, as Club does (as before package A).
  await page.evaluate(() => window.__squib!.controller.setLevel('learn'));
  await expect(page.locator('[data-cell="twa"] .cell-label')).toHaveText('TWA');
  // Back on: the plain words return at Learn.
  await page.evaluate(() => window.__squib!.controller.setFeature('plainLanguage', true));
  await expect(page.locator('[data-cell="twa"] .cell-label')).toHaveText('Wind');
  expect(errors).toEqual([]);
});

for (const on of [true, false]) {
  test(`§3.1: the Learn map ${on ? 'on (the default): in the Settings menu' : 'switched off: not in the Settings menu, Lessons heading its group'}`, async ({ page }) => {
    test.setTimeout(150_000 * CI_SLOW);
    if (!on) await page.addInitScript(() => localStorage.setItem('squib.flag.learnMap', '0'));
    const errors = await ready(page);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('menuitemcheckbox', { name: 'Lessons' })).toBeVisible();
    await expect(page.getByRole('menuitemcheckbox', { name: 'Learn map' })).toHaveCount(on ? 1 : 0);
    expect(errors).toEqual([]);
  });
}
