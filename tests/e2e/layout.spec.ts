import { expect, test, type Page } from '@playwright/test';

/** CI runners draw the scene in software, several times slower (playwright.config.ts). */
const CI_SLOW = process.env.CI ? 2 : 1;

/**
 * Comprehensive review, Package 2 (UX-5): the regions of the screen never overlap. The instruments (with the race
 * panel and the coach under them), the toolbar, the sailing dock and the minimap each keep their own region at
 * the five sizes the review names, in free sailing and in a race.
 */
const SIZES = [
  { width: 360, height: 640 },
  { width: 390, height: 844 },
  { width: 1000, height: 560 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
];

type Box = { name: string; x: number; y: number; w: number; h: number };

async function regions(page: Page): Promise<Box[]> {
  return page.evaluate(() => {
    const out: Box[] = [];
    const add = (name: string, sel: string) => {
      for (const el of document.querySelectorAll<HTMLElement>(sel)) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden') out.push({ name, x: r.x, y: r.y, w: r.width, h: r.height });
      }
    };
    add('instruments', '.hud-left');
    add('toolbar', '.toolbar');
    add('dock', '.controls, .controls-show');
    add('minimap', '.minimap');
    return out;
  });
}

function overlaps(boxes: Box[]): string[] {
  const bad: string[] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > 1 && oy > 1) bad.push(`${a.name} × ${b.name} (${Math.round(ox)}×${Math.round(oy)} px)`);
    }
  }
  return bad;
}

test('the instruments, toolbar, dock and minimap never overlap, at five screen sizes, sailing and racing', async ({ page }) => {
  test.setTimeout(240_000 * CI_SLOW);
  await page.goto('/?nowelcome');
  await expect(page.getByTestId('stw')).toBeVisible();
  await page.waitForFunction(() => window.__squib!.controller.getState().dart.status !== 'loading', null, { timeout: 60_000 * CI_SLOW });
  // The browser lays out after a resize between frames; in software rendering a full-size frame takes seconds, so
  // the picture is drawn at a quarter of the pixels here (the layout under test does not depend on it).
  await page.evaluate(() => {
    const c = window.__squib!.controller;
    c.setGraphics({ ...c.getState().graphics!, preset: 'custom', resolutionScale: 0.5, maxPixelRatio: 1, water: 'low', spray: false, atmosphere: false });
  });
  for (const phase of ['sailing', 'racing'] as const) {
    if (phase === 'racing') {
      await page.evaluate(() => window.__squib!.controller.startQuickRace({ competitors: 3, level: 'good', venue: 'start-bay', course: 'windward-leeward', conditions: 'random', wind: 'any', seed: 3, sequence: 'one-minute' }));
      await expect(page.getByTestId('coach')).toBeVisible();
    }
    for (const size of SIZES) {
      await page.setViewportSize(size);
      // The regions are measured after a resize (App.tsx), a frame or two later; in software rendering that takes a while.
      await expect
        .poll(async () => {
          const b = await regions(page);
          const found = overlaps(b);
          if (!['instruments', 'toolbar', 'dock'].every((n) => b.some((x) => x.name === n))) found.push('a region is missing');
          // Nothing runs off the screen.
          for (const x of b) if (x.x < -1 || x.y < -1 || x.x + x.w > size.width + 1 || x.y + x.h > size.height + 1) found.push(`${x.name} off screen`);
          return found;
        }, { message: `${phase} at ${size.width}×${size.height}`, timeout: 10_000 * CI_SLOW })
        .toEqual([]);
    }
  }
});
