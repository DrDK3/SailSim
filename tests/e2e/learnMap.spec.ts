import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Package D (review #13, #14): the Learn map, and the player and instructor views. In the player view the honesty
 * labels are gathered in About behind one "How far to trust this" link; the instructor view shows them where they
 * apply. Nothing is removed. Time is driven with window.__squib.advance, not the wall clock.
 */
const CI_SLOW = process.env.CI ? 2 : 1;

async function ready(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?nowelcome&conditions=set&quality=low');
  await expect(page.getByTestId('stw')).toBeVisible();
  await page.waitForFunction(() => window.__squib!.controller.getState().dart.status !== 'loading', null, { timeout: 60_000 * CI_SLOW });
  return errors;
}

const menu = async (page: Page, item: string) => {
  // On a phone the toolbar folds behind "Menu".
  const fold = page.getByRole('button', { name: 'Menu', exact: true });
  if (await fold.isVisible()) await fold.click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: item }).or(page.getByRole('menuitem', { name: item })).first().click();
};

test('player view: one "How far to trust this" link opens About at the labels; the instructor view shows them where they apply', async ({ page }) => {
  test.setTimeout(180_000 * CI_SLOW);
  const errors = await ready(page);
  // Player view (the default): the link, and no labels inline.
  const link = page.getByTestId('trust-link');
  await expect(link).toBeVisible();
  await page.getByRole('button', { name: 'Conditions', exact: true }).click();
  const conditions = page.getByRole('region', { name: 'Conditions' });
  await expect(conditions).toContainText('How your helm is drawn');
  await expect(conditions).not.toContainText('Appearance only');
  await expect(conditions.getByTestId('trust-note')).toHaveCount(0);
  await page.getByRole('button', { name: 'Conditions', exact: true }).click();
  // The link opens About at "How far to trust this", which keeps the same statements.
  await link.click();
  const about = page.getByTestId('about');
  await expect(about).toBeVisible();
  await expect(page.getByTestId('about-trust')).toBeFocused();
  await expect(about).toContainText('The helm figure is appearance only');
  await expect(about).toContainText('their thresholds are provisional (E)');
  await expect(about).toContainText('Not for navigation or performance prediction');
  const axe = await new AxeBuilder({ page }).include('[data-testid=about]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(about).toHaveCount(0);

  // Instructor view: the labels where they apply, and no link.
  await menu(page, 'Instructor view (where each figure comes from)');
  await expect(page.getByTestId('trust-link')).toHaveCount(0);
  await page.getByRole('button', { name: 'Conditions', exact: true }).click();
  await expect(conditions).toContainText('Appearance only: the boat');
  await expect(conditions.getByTestId('trust-note').first()).toBeVisible();
  // Kept across a reload (this browser only).
  await page.reload();
  await expect(page.getByTestId('stw')).toBeVisible();
  expect(await page.evaluate(() => window.__squib!.controller.getState().prefs.instructorView)).toBe(true);
  await expect(page.getByTestId('trust-link')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the Learn map: the lessons, exercises and challenges in order, the next step suggested and started, progress noted', async ({ page }) => {
  test.setTimeout(180_000 * CI_SLOW);
  const errors = await ready(page);
  await menu(page, 'Learn map');
  const map = page.getByTestId('learn-map');
  await expect(map).toBeVisible();
  for (const h of ['Basics', 'Seamanship', 'Exercises', 'Challenges']) await expect(map.getByRole('heading', { name: h })).toBeVisible();
  await expect(map.locator('li')).toHaveCount(15);
  await expect(page.getByTestId('learn-map-progress')).toContainText('0 of 15 done');
  await expect(page.getByTestId('learn-next')).toContainText('Next: Steering');
  const axe = await new AxeBuilder({ page }).include('[data-testid=learn-map]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  // Start the suggested step: the first lesson.
  await page.getByTestId('learn-next-start').click();
  await expect(map).toHaveCount(0);
  await expect(page.getByTestId('tutorial')).toBeVisible();
  await expect(page.getByTestId('tutorial')).toContainText('Steering');
  // Reopened: the lesson is marked as started (kept in this browser).
  await menu(page, 'Learn map');
  await expect(page.getByTestId('learn-step-lesson:steer')).toContainText('started');
  // The lesson is under way: the button goes back to it (it does not restart it; design handover item 8).
  await expect(page.getByTestId('learn-next-start')).toContainText('Back to it');
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test.describe('on a touch phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the Learn map: every control at least 44 × 44 px, no sideways scroll', async ({ page }) => {
    test.setTimeout(180_000 * CI_SLOW);
    const errors = await ready(page);
    await menu(page, 'Learn map');
    const map = page.getByTestId('learn-map');
    await expect(map).toBeVisible();
    const small = await map.evaluate((el) =>
      [...el.querySelectorAll('button')]
        .map((b) => ({ t: (b.getAttribute('aria-label') ?? b.textContent ?? '').trim().slice(0, 30), r: b.getBoundingClientRect() }))
        .filter((x) => x.r.width > 0 && (x.r.height < 44 || x.r.width < 44))
        .map((x) => `${x.t} ${Math.round(x.r.width)}×${Math.round(x.r.height)}`),
    );
    expect(small).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
  });
});
