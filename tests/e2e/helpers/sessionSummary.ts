import { expect, type Page } from '@playwright/test';

/**
 * The session's one-line summary ("River Dart (depths and stream provisional) · wind 15 kn …"), read from More →
 * Layers and sources, where it moved from the line along the bottom of the screen (owner, 6 Nov 2026). The panel
 * loads on first use, slowly in software rendering; if the summary does not appear, the failure says what is open.
 */
export async function expectSessionSummary(page: Page, text: string): Promise<void> {
  // After a restart, let its first frames draw: in software rendering they can hold the page for tens of seconds.
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  await page.evaluate(() => window.__squib!.controller.toggleLayers(true));
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            document.querySelector('[data-testid="session-summary"]')?.textContent ??
            `(no summary: layers ${window.__squib!.controller.getState().showLayers ? 'open' : 'closed'}; dialogs: ${
              [...document.querySelectorAll('[role="dialog"]')].map((d) => d.getAttribute('aria-label')).join(', ') || 'none'
            })`,
        ),
      { message: 'the session summary in Layers and sources', timeout: 30_000 },
    )
    .toContain(text);
  await page.evaluate(() => window.__squib!.controller.toggleLayers(false));
}
