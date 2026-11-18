import { expect, test, type Page } from '@playwright/test';

/**
 * Owner, 18 Nov 2026: a race display built for glancing (a large countdown for the last minute, an arrow at the
 * screen's edge to the next mark, the rulings and the disclaimer in the results); racing on a phone (the race panel
 * as one line); the tactical aids (laylines, the course on the minimap, lifted or headed), tied to the interface
 * levels; the finish as a moment (your place large with the gaps, places at each mark, the fleet's tracks and a
 * replay from above). The lighter welcome and the About page are in welcome.spec.ts. Software rendering only
 * (SwiftShader): the canvases are checked as drawn, not judged by eye. The AI sails your boat (the tests' hook) so
 * that a race can be finished.
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

/** A short race in Start Bay against three AI boats, paused, the start signal 70 s in; the AI on your helm. */
async function startRace(page: Page) {
  await page.evaluate(() => {
    const c = window.__squib!.controller;
    c.setLevel('club');
    c.startQuickRace({ competitors: 3, level: 'good', venue: 'start-bay', course: 'windward-leeward', conditions: 'random', wind: 'any', seed: 5, sequence: 'one-minute', legM: 250, laps: 1, startInS: 70 });
    if (!c.getState().paused) c.togglePause();
    window.__squib!.aiHelm('good');
  });
}

/** The canvas is not one flat colour: something was drawn on it. */
const drawn = (page: Page, testId: string) =>
  page.getByTestId(testId).evaluate((cv) => {
    const c = cv as HTMLCanvasElement;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const seen = new Set<number>();
    for (let i = 0; i < d.length; i += 4 * 97) seen.add((d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!);
    return seen.size;
  });

test('a race at a glance: the last-minute countdown, the arrow to the line, the course on the minimap, the aids by level', async ({ page }) => {
  test.setTimeout(240_000 * CI_SLOW);
  const errors = await ready(page);
  await startRace(page);
  const count = page.getByTestId('big-countdown');
  // More than a minute to go: no large countdown yet.
  await expect(count).toHaveCount(0);
  await page.evaluate(() => window.__squib!.advance(40));
  await expect(count).toHaveText('0:30', { timeout: 30_000 * CI_SLOW });
  // Top centre, clear of the instruments and of the toolbar.
  const [cb, hud, bar] = await Promise.all([count.boundingBox(), page.locator('.hud-left').boundingBox(), page.locator('nav.toolbar').boundingBox()]);
  expect(Math.abs(cb!.x + cb!.width / 2 - 640)).toBeLessThan(4);
  expect(cb!.x).toBeGreaterThan(hud!.x + hud!.width);
  expect(cb!.y).toBeGreaterThanOrEqual(bar!.y + bar!.height);
  expect(cb!.height).toBeGreaterThan(50);
  // The race panel no longer carries the fleet's rulings or the standing disclaimer.
  const panel = page.getByTestId('race-panel');
  await expect(panel).not.toContainText('Fleet events');
  await expect(panel).not.toContainText('Simplified rules');

  // The arrow: shown when the line is out of view, with its distance, inside the screen and off the panels.
  const pointer = await page.evaluate(async () => {
    const c = window.__squib!.controller;
    const t = c.raceTarget!;
    // Two frames, so that the arrow has been placed for this moment.
    await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
    const ndc = c.screenOf(t.n, t.e)!;
    const el = document.querySelector<HTMLElement>('[data-testid="mark-pointer"]')!;
    const r = el.getBoundingClientRect();
    const box = (q: string) => {
      const b = document.querySelector(q)?.getBoundingClientRect();
      return b ? { l: b.left, t: b.top, r: b.right, b: b.bottom } : undefined;
    };
    return { label: t.label, off: ndc.behind || Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1, shown: el.dataset.shown === '1', text: el.textContent, rect: { l: r.left, t: r.top, r: r.right, b: r.bottom }, hud: box('.hud-left'), map: box('.minimap'), w: innerWidth, h: innerHeight };
  });
  expect(pointer.label).toBe('Start line');
  if (pointer.off) {
    expect(pointer.shown, 'the line is out of view, so the arrow shows').toBe(true);
    expect(pointer.text).toMatch(/^Start line · \d+ m$/);
    expect(pointer.rect.l).toBeGreaterThanOrEqual(0);
    expect(pointer.rect.r).toBeLessThanOrEqual(pointer.w);
    expect(pointer.rect.t).toBeGreaterThanOrEqual(0);
    expect(pointer.rect.b).toBeLessThanOrEqual(pointer.h);
    for (const b of [pointer.hud, pointer.map]) {
      if (!b) continue;
      const meets = pointer.rect.l < b.r && pointer.rect.r > b.l && pointer.rect.t < b.b && pointer.rect.b > b.t;
      expect(meets, 'the arrow is not over a panel').toBe(false);
    }
  }

  // The minimap shows the whole course, and goes back to following the boat with + or −.
  const map = page.getByTestId('minimap');
  await expect(map).toHaveAttribute('data-view', 'course');
  await expect(page.getByTestId('minimap-course')).toHaveAttribute('aria-pressed', 'true');
  expect(await drawn(page, 'minimap')).toBeGreaterThan(5);
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(map).toHaveAttribute('data-view', 'boat');
  await page.getByTestId('minimap-course').click();
  await expect(map).toHaveAttribute('data-view', 'course');
  await expect(page.getByTestId('minimap-scale')).toHaveText(/\d+(\.\d+)? (m|km)/);

  // Past the start: "Start" for a moment, then no countdown; beating to the first mark, the aids show.
  await page.evaluate(() => window.__squib!.advance(31));
  await expect(count).toHaveText('Start', { timeout: 30_000 * CI_SLOW });
  const racing = await page.evaluate(() => {
    const c = window.__squib!.controller;
    // Sail until she is beating on the first leg (the AI may take a little while to start).
    for (let i = 0; i < 60; i++) {
      window.__squib!.advance(5);
      const r = c.getState().race!;
      if (r.phase === 'racing' && r.shift && c.raceLaylines) break;
    }
    const r = c.getState().race!;
    return { phase: r.phase, shift: r.shift, lay: c.raceLaylines, aids: c.getState().raceAids, target: c.raceTarget?.label };
  });
  // The laylines lie on the water in the 3D view (once a frame has been drawn with them).
  const layInScene = () =>
    page.evaluate(() => {
      let seen = false;
      (window.__squib!.controller as unknown as { view: { scene: { traverse: (f: (o: { name: string; visible: boolean }) => void) => void } } }).view.scene.traverse((o) => {
        if (o.name === 'layline' && o.visible) seen = true;
      });
      return seen;
    });
  await expect.poll(layInScene, { timeout: 60_000 * CI_SLOW }).toBe(true);
  expect(racing.phase).toBe('racing');
  expect(racing.aids).toBe(true);
  expect(racing.shift).toBeDefined();
  expect(racing.lay?.kind).toBe('beat');
  expect(racing.lay?.lines.map((l) => l.tack)).toEqual(['starboard', 'port']);
  expect(racing.target).toMatch(/Windward/);
  await expect(count).toHaveCount(0);
  await expect(page.getByTestId('shift-call')).toHaveText(/Lifted \d+°|Headed \d+°|Wind steady/);

  // Expert: the aids go (and can be put back by hand); Club brings them back.
  const levels = await page.evaluate(() => {
    const c = window.__squib!.controller;
    c.setLevel('expert');
    const expert = { aids: c.getState().raceAids, lay: !!c.raceLaylines, shift: !!c.getState().race!.shift };
    c.setRaceAids(true);
    const byHand = { aids: c.getState().raceAids, lay: !!c.raceLaylines };
    c.setLevel('learn');
    const learn = c.getState().raceAids;
    c.setLevel('club');
    return { expert, byHand, learn, club: c.getState().raceAids };
  });
  expect(levels.expert).toEqual({ aids: false, lay: false, shift: false });
  expect(levels.byHand).toEqual({ aids: true, lay: true });
  expect(levels.learn).toBe(true);
  expect(levels.club).toBe(true);
  await page.evaluate(() => window.__squib!.controller.setRaceAids(false));
  await expect(page.getByTestId('shift-call')).toHaveCount(0);
  await expect.poll(layInScene, { timeout: 60_000 * CI_SLOW }).toBe(false);
  expect(errors).toEqual([]);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the race is one line: the countdown or your place, the next mark, an arrow; tap it for the panel', async ({ page }) => {
    test.setTimeout(240_000 * CI_SLOW);
    const errors = await ready(page);
    await startRace(page);
    await page.evaluate(() => window.__squib!.advance(40));
    const strip = page.getByTestId('race-strip');
    await expect(strip).toBeVisible({ timeout: 30_000 * CI_SLOW });
    await expect(page.getByTestId('race-strip-lead')).toHaveText('0:30');
    await expect(strip).toContainText(/Line\s*\d+ m/);
    await expect(strip.locator('.race-strip-arrow')).toBeVisible();
    // One line: the full panel and the coach are put away, and so are the large countdown and the edge arrow.
    await expect(page.getByTestId('race-panel')).toHaveCount(0);
    await expect(page.getByTestId('coach')).toHaveCount(0);
    await expect(page.getByTestId('big-countdown')).toHaveCount(0);
    await expect(page.getByTestId('mark-pointer')).toHaveCount(0);
    const sb = (await strip.boundingBox())!;
    expect(sb.height).toBeLessThanOrEqual(52);
    // Water in view between the instruments (with the strip) and the sailing controls: more than a third of the screen.
    const gap = await page.evaluate(() => {
      const hud = document.querySelector('.hud-left')!.getBoundingClientRect();
      const dock = (document.querySelector('.dock-wrap') ?? document.querySelector('.panel.dock'))!.getBoundingClientRect();
      return dock.top - hud.bottom;
    });
    expect(gap).toBeGreaterThan(844 / 3);

    // Racing: the place leads, then the next mark by its short name with its distance.
    await page.evaluate(() => {
      const c = window.__squib!.controller;
      for (let i = 0; i < 60; i++) {
        window.__squib!.advance(5);
        if (c.getState().race!.phase === 'racing') break;
      }
    });
    await expect(page.getByTestId('race-strip-lead')).toHaveText(/^\d+(st|nd|rd|th)\/4$/, { timeout: 30_000 * CI_SLOW });
    await expect(strip).toContainText(/Windward\s*\d+ m/);
    await expect(strip).toHaveAccessibleName(/Race: \d+(st|nd|rd|th) of 4, Windward to port \d+ m/);
    // The whole line stays inside the screen.
    const wide = await strip.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth, right: el.getBoundingClientRect().right }));
    expect(wide.right).toBeLessThanOrEqual(390);

    // Tap for the full panel; tap again to put it away.
    await strip.evaluate((el) => (el as HTMLElement).click());
    await expect(page.getByTestId('race-panel')).toBeVisible();
    await expect(strip).toHaveAttribute('aria-expanded', 'true');
    await strip.evaluate((el) => (el as HTMLElement).click());
    await expect(page.getByTestId('race-panel')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test('the finish: your place large with the gaps, places at each mark, the rulings in the results, the race from above', async ({ page }) => {
  test.setTimeout(360_000 * CI_SLOW);
  const errors = await ready(page);
  await startRace(page);
  const end = await page.evaluate(() => {
    const c = window.__squib!.controller;
    for (let i = 0; i < 240 && c.getState().race!.phase !== 'finished' && !c.getState().race!.raceOver; i++) window.__squib!.advance(10);
    const r = c.getState().race!;
    return { phase: r.phase, over: r.raceOver, story: r.story, places: r.markPlaces, samples: c.fleetTrack.length, boats: c.fleetTrack.boats.length, results: !!r.results };
  });
  expect(end.phase, 'the AI on your helm finished the course').toBe('finished');
  expect(end.story).toBeDefined();
  expect(end.boats).toBe(4);
  expect(end.samples).toBeGreaterThan(100);
  // The results open by themselves when you finish, whether or not the others are still racing.
  const results = page.getByTestId('results');
  await expect(results).toBeVisible({ timeout: 30_000 * CI_SLOW });
  if (!end.over) await expect(page.getByTestId('finish-story')).toContainText('provisional: boats are still racing');
  // Your place, large, with the gaps to the boats either side.
  const place = page.getByTestId('finish-place');
  await expect(place).toHaveText(new RegExp(`^${end.story!.place}(st|nd|rd|th)\\s*of 4$`));
  const size = await place.locator('.finish-place-n').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(size).toBeGreaterThanOrEqual(44);
  await expect(page.getByTestId('finish-gaps')).toHaveText(end.story!.place === 1 ? /You won/ : /\d+(\.\d)? s behind|\d+ min \d+ s behind/);
  // Your place at the start, at each mark and at the finish, in the order sailed.
  const chips = await page.getByTestId('mark-places').locator('li').allInnerTexts();
  expect(chips.length).toBe(end.places!.length);
  expect(chips[0]).toMatch(/Start\s+\d+(st|nd|rd|th)/);
  expect(chips[1]).toMatch(/Windward\s+\d+(st|nd|rd|th)/);
  expect(chips[chips.length - 1]).toMatch(new RegExp(`Finish\\s+${end.story!.place}(st|nd|rd|th)`));
  // The standing disclaimer lives here now.
  await expect(page.getByTestId('results-disclaimer')).toHaveText(/Simplified rules, not an authoritative adjudication/);
  await expect(results.locator('tbody tr')).toHaveCount(4);

  // The debrief opens on the race from above: every boat's track over the course.
  await page.evaluate(() => {
    const c = window.__squib!.controller;
    c.toggleResults(false);
    c.toggleDebrief(true);
  });
  const replay = page.getByTestId('race-replay');
  await expect(replay).toBeVisible({ timeout: 30_000 * CI_SLOW });
  await expect(page.getByTestId('debrief-view-fleet')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => drawn(page, 'race-replay-map'), { timeout: 30_000 * CI_SLOW }).toBeGreaterThan(8);
  await expect(replay.locator('.replay-legend li')).toHaveCount(4);
  await expect(replay.locator('.replay-legend li').first()).toHaveText('You');
  // It opens at the end of the record; drag the time back and the clock follows.
  const clock = page.getByTestId('race-replay-clock');
  const atEnd = await clock.innerText();
  expect(atEnd).toMatch(/^\d+:\d\d after the start$/);
  const time = page.getByTestId('race-replay-time');
  const [min, max] = await time.evaluate((el) => [Number((el as HTMLInputElement).min), Number((el as HTMLInputElement).max)]);
  expect(max - min).toBeGreaterThan(120);
  await time.fill(String(min + 30));
  await expect(clock).toHaveText(/^0:(39|40) to the start$/);
  // Play: the moment runs on (16 times the race's speed), and Pause holds it.
  const play = page.getByTestId('race-replay-play');
  await play.evaluate((el) => (el as HTMLElement).click());
  await expect(play).toHaveText('Pause');
  await expect.poll(async () => Number(await time.inputValue()), { timeout: 60_000 * CI_SLOW }).toBeGreaterThan(min + 45);
  await play.evaluate((el) => (el as HTMLElement).click());
  await expect(play).toHaveText('Play');
  const held = Number(await time.inputValue());
  await page.waitForTimeout(600);
  expect(Number(await time.inputValue())).toBe(held);
  // Your own track by speed is one tap away.
  await page.getByTestId('debrief-view-track').evaluate((el) => (el as HTMLElement).click());
  await expect(page.getByTestId('race-replay')).toHaveCount(0);
  await expect(page.getByTestId('debrief')).toContainText('Speed over the ground');
  expect(errors).toEqual([]);
});
