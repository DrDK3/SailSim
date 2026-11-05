import { expect, test } from '@playwright/test';

/**
 * The sailing dock, redesigned (owner review, 5 Nov 2026: "cannot be read and labels do not fit"): at a laptop's,
 * a tablet's and a phone's size nothing in it is clipped, the sheet meters show their whole value ("100% eased"),
 * and the sails' states read in full.
 */

const CI_SLOW = process.env.CI ? 2 : 1;

for (const size of [
  { width: 1280, height: 800 },
  { width: 1024, height: 700 },
  { width: 390, height: 844 },
]) {
  test(`the dock reads in full at ${size.width}×${size.height}`, async ({ page }) => {
    test.setTimeout(120_000 * CI_SLOW);
    await page.setViewportSize(size);
    await page.goto('/?nowelcome&quality=low');
    const dock = page.getByRole('region', { name: 'Sailing controls' });
    await expect(dock).toBeVisible();
    // The river's data loaded first: the boat restarts with trimmed sails when it arrives.
    await page.waitForFunction(() => window.__squib!.controller.getState().dart.status !== 'loading', null, { timeout: 60_000 * CI_SLOW });
    // Both sheets let right out, auto-trim off: the longest values and states ("100% eased", "Luffing · trim in (W)").
    await page.evaluate(() => {
      const c = window.__squib!.controller;
      c.setInput({ autoMain: false, autoJib: false, mainSheet: 1, jibSheet: 1 });
      if (!c.getState().paused) c.togglePause();
    });
    await expect(page.getByTestId('main-status')).toContainText('Luffing · trim in (W)');
    const found = await dock.evaluate((root) => {
      const out: string[] = [];
      for (const el of root.querySelectorAll<HTMLElement>('*')) {
        const cs = getComputedStyle(el);
        // Text for screen readers only is clipped on purpose.
        if (cs.display === 'none' || el.clientWidth === 0 || el.classList.contains('sr-only')) continue;
        if (cs.overflow !== 'visible' && el.scrollWidth > el.clientWidth + 1) out.push(`clipped: ${el.className || el.tagName} (${el.scrollWidth} > ${el.clientWidth})`);
      }
      // Each sheet meter's value fits inside the meter.
      for (const m of root.querySelectorAll<HTMLElement>('.sheet-meter')) {
        const v = m.querySelector<HTMLElement>('.sheet-value')!;
        if (v.getBoundingClientRect().width > m.getBoundingClientRect().width - 4) out.push(`meter too narrow: ${v.textContent}`);
        if (!/\d+% eased/.test(v.textContent ?? '')) out.push(`meter shows "${v.textContent}"`);
      }
      return out;
    });
    expect(found).toEqual([]);
    for (const sail of ['main', 'jib']) await expect(page.getByTestId(`${sail}-sheet`)).toHaveAttribute('aria-valuenow', '100');
  });
}
