import { expect, test, type Page } from '@playwright/test';

/**
 * Owner, 18 Nov 2026: "a lighter first minute". The first-visit welcome is one question and a large "Sail now"; the
 * four ways in wait behind "More ways to sail", and what the simulator is and how far to trust it is on the About
 * page (from the welcome, and from Settings → About this simulator).
 */
const CI_SLOW = process.env.CI ? 2 : 1;

async function ready(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?nowelcome&quality=low');
  await expect(page.getByTestId('stw')).toBeVisible();
  await page.waitForFunction(() => window.__squib!.controller.getState().dart.status !== 'loading', null, { timeout: 60_000 * CI_SLOW });
  return errors;
}

test.describe('first visit', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('the welcome is one question and a large "Sail now"; the other ways in and the About page are a tap away', async ({ page }) => {
    test.setTimeout(150_000 * CI_SLOW);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/?quality=low');
    const hub = page.getByRole('dialog', { name: 'Squib sailing simulator' });
    await expect(hub).toBeVisible({ timeout: 60_000 * CI_SLOW });
    await expect(page.getByTestId('steering-ask')).toContainText('Have you sailed before?');
    const sail = page.getByTestId('sail-now');
    await expect(sail).toBeFocused();
    expect(await sail.locator('.sail-now-title').evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(24);
    // Light: no caveat, no four doors, well under the old 150 words.
    await expect(hub).not.toContainText('estimates');
    await expect(hub).not.toContainText('Met Office');
    for (const door of ['learn', 'free', 'race', 'scenarios']) await expect(page.getByTestId(`door-${door}`)).toHaveCount(0);
    const words = (await hub.innerText()).split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
    expect(words).toBeLessThanOrEqual(60);
    // The other ways in.
    await page.getByTestId('hub-more').click();
    for (const door of ['Learn to sail', 'Free sailing', 'Race against AI', 'Scenarios']) await expect(hub.getByRole('button', { name: door })).toBeVisible();
    await expect(hub).not.toContainText('Met Office replay');
    // About: what it is and how far to trust it; Back returns to the question.
    await page.getByTestId('hub-about').click();
    const about = page.getByTestId('about');
    await expect(about).toContainText('coefficients are estimates');
    await expect(about).toContainText('Not for navigation or performance prediction');
    await expect(about).toContainText('not an authoritative adjudication');
    await expect(page.getByTestId('steering-ask')).toHaveCount(0);
    await page.getByTestId('about-back').click();
    await expect(page.getByTestId('steering-ask')).toBeVisible();
    await expect(about).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test('Settings → About this simulator opens the About page on its own', async ({ page }) => {
  test.setTimeout(120_000 * CI_SLOW);
  const errors = await ready(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: 'About this simulator' }).click();
  const dialog = page.getByRole('dialog', { name: 'About this simulator' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('coefficients are estimates');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(errors).toEqual([]);
});
