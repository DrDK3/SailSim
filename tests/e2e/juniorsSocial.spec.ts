import { expect, test } from '@playwright/test';

/**
 * Juniors round, Workstream 3 layer A (no server): the weekly course card copes with a missing, stale or valid targets
 * file; a target's ghost can be raced; "Challenge a friend" makes a link that another browser opens as a challenge
 * card with a word-list name, and accepting races the run as a ghost. No request leaves for anything but the site's
 * own files. Software rendering: waits are on the app's state.
 */
const CI_SLOW = process.env.CI ? 2 : 1;

async function ready(page: import('@playwright/test').Page) {
  await page.goto('/?nowelcome&quality=low');
  await page.waitForFunction(() => window.__squib!.controller.getState().dart.status !== 'loading', null, { timeout: 90_000 * CI_SLOW });
}

test('weekly course: targets missing, stale, then published; a target ghost races', async ({ page }) => {
  test.setTimeout(180_000 * CI_SLOW);
  const hosts = new Set<string>();
  page.on('request', (r) => hosts.add(new URL(r.url()).host));
  let serve: 'none' | 'stale' | 'ok' = 'none';
  const served: { file?: unknown } = {};
  await page.route('**/weekly/*.json', async (route) => {
    if (serve === 'none') return route.fulfill({ status: 404, body: 'not found' });
    if (serve === 'stale') return route.fulfill({ json: { schema: 'squib-weekly-targets/1', week: '2020-W01', generated: '2020-01-01T00:00:00Z', targets: [] } });
    return route.fulfill({ json: served.file });
  });
  await ready(page);
  await page.getByRole('button', { name: 'Race', exact: true }).click();
  const card = page.getByTestId('weekly-card');
  await expect(card).toBeVisible();
  await expect(card.getByTestId('weekly-targets-unavailable')).toContainText('not published yet');
  // A file from another week: not used.
  serve = 'stale';
  await page.evaluate(() => {
    const s = window.__squib!.controller.social as unknown as { targetsFor?: string; loadTargets(): Promise<void> };
    s.targetsFor = undefined;
    return s.loadTargets();
  });
  await expect(card.getByTestId('weekly-targets-unavailable')).toContainText('2020-W01');
  // This week's file (made here from the app's own week and scenario, with a short track).
  served.file = await page.evaluate(() => {
    const w = window.__squib!.controller.social.weekly();
    const row = (t: number) => [t, -1800 + t, 1300, 0, 0.1, 0.2, -0.1, 1, 1, 0, 2, 0.5, 1, 1, 0.6, 5];
    const track = { everyS: 1, rows: [0, 1, 2, 3, 4, 5].map(row) };
    return {
      schema: 'squib-weekly-targets/1', week: w.week.key, generated: new Date(Date.now() - 30 * 60e3).toISOString(), build: 'test', course: w.name, scenario: JSON.stringify(w.scenario),
      // Review #11: gold is the expert AI's time, silver and bronze 10% and 25% slower (their ghosts the gold one slowed).
      targets: [{ medal: 'bronze', level: 'expert', timeS: 450, slowedBy: 0.25, runs: [], track }, { medal: 'silver', level: 'expert', timeS: 396, slowedBy: 0.1, runs: [], track }, { medal: 'gold', level: 'expert', timeS: 360, runs: [360], track }],
      note: 'Model-sailed targets',
    };
  });
  serve = 'ok';
  await page.evaluate(() => {
    const s = window.__squib!.controller.social as unknown as { targetsFor?: string; loadTargets(): Promise<void> };
    s.targetsFor = undefined;
    return s.loadTargets();
  });
  await expect(card.getByTestId('weekly-targets-line')).toHaveText('gold 6:00 · silver 6:36 · bronze 7:30');
  await expect(card.getByTestId('weekly-targets')).toContainText('Gold is the simulator’s expert AI (not people); silver and bronze are its time 10% and 25% slower (estimates). Updated 30 minutes ago');
  await expect(card.getByRole('button', { name: /^Silver 6:36\.0$/ })).toHaveAttribute('title', /slowed 10% to the silver time/);
  // Review #10: the RDYC courses at full length are the optional long course, still pending the club's check.
  await expect(card.getByTestId('weekly-long')).toContainText('Long course (optional)');
  await expect(card.getByTestId('weekly-long')).toContainText('pending club check');
  await card.getByRole('button', { name: /^Gold 6:00\.0$/ }).click();
  await page.waitForFunction(() => window.__squib!.controller.getState().ghost?.title.startsWith('Gold target'), null, { timeout: 60_000 * CI_SLOW });
  const st = await page.evaluate(() => window.__squib!.controller.getState());
  expect(st.scenario.conditions.current).toEqual({ mode: 'none' });
  expect(st.scenario.fleet?.aiCount).toBe(0);
  // Only the site itself was asked for anything.
  expect([...hosts].every((h) => h === 'localhost:4173')).toBe(true);
});

test('challenge a friend: the link round-trips into another browser as a challenge card, then a ghost race', async ({ page, browser }) => {
  test.setTimeout(240_000 * CI_SLOW);
  await ready(page);
  // A finish on this week's course (sailed for a few seconds; the finish itself is reported to the hub, as the judge
  // would, since sailing the whole course here would take an hour of software rendering).
  await page.evaluate(() => {
    const c = window.__squib!.controller;
    c.social.sailWeekly();
    window.__squib!.advance(5);
    c.social.onFinish(c.social.ui().weekly.key, 'This week’s course', 312.4, [{ t: 200, type: 'rounded', leg: 0, label: 'Windward mark', time: 230 }], 90);
    c.toggleResults(true);
  });
  // Results only show with a race's results; the finish panel shows for the like-for-like finish.
  await page.evaluate(() => {
    const c = window.__squib!.controller;
    (c as unknown as { publish(f: boolean): void }).publish(true);
  });
  const name = await page.evaluate(() => window.__squib!.controller.social.name);
  expect(name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+ [1-9][0-9]?$/);
  const url = await page.evaluate(() => window.__squib!.controller.social.challengeLink(location.href));
  expect(url).toMatch(/#challenge=c1\./);
  expect(url!.split('#')[0]).not.toContain(name.split(' ')[0]!);
  // A friend's browser (its own storage).
  const ctx = await browser.newContext({ baseURL: 'http://localhost:4173', storageState: { cookies: [], origins: [{ origin: 'http://localhost:4173', localStorage: [{ name: 'squib.welcomed.v1', value: '1' }] }] } });
  const friend = await ctx.newPage();
  await friend.goto(`/?nowelcome&quality=low#${url!.split('#')[1]}`);
  // The link is read once the River Dart has loaded (the run was sailed with it).
  await friend.waitForFunction(() => window.__squib?.controller.getState().dart.status !== 'loading', null, { timeout: 180_000 * CI_SLOW });
  const card = friend.getByTestId('challenge-card');
  await expect(card).toBeVisible({ timeout: 60_000 * CI_SLOW });
  await expect(card).toContainText(`${name} challenges you`);
  await expect(card).toContainText('5:12.4');
  await expect(card).toContainText('does not react');
  // The address no longer holds the run (a reload does not repeat it).
  expect(new URL(friend.url()).hash).toBe('');
  await card.getByTestId('challenge-accept').click();
  await expect(friend.getByTestId('ghost-chip')).toBeVisible({ timeout: 120_000 * CI_SLOW });
  const racing = await friend.evaluate(() => window.__squib!.controller.getState().social.racing);
  expect(racing).toEqual({ name, finishS: 312.4 });
  // Their finish compared with the challenge.
  const res = await friend.evaluate(() => {
    const c = window.__squib!.controller;
    c.social.onFinish(c.social.ui().weekly.key, 'This week’s course', 300.1, [{ t: 200, type: 'rounded', leg: 0, label: 'Windward mark', time: 228 }], 90);
    return c.getState().social.result;
  });
  expect(res!.headline).toBe(`You beat ${name} by 12 s`);
  await ctx.close();
});

test('a challenge link with a name not from the word list is refused, with a reason', async ({ page }) => {
  test.setTimeout(150_000 * CI_SLOW);
  await ready(page);
  const forged = await page.evaluate(async () => {
    const c = window.__squib!.controller;
    const rec = c.saveRecording('x');
    const json = new TextEncoder().encode(JSON.stringify({ v: 1, name: 'Sam from Year 8', course: 'x', key: 'k', finishS: 10, splits: [], independent: true, rec }));
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return 'c1.' + btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  });
  await page.evaluate((p) => window.__squib!.controller.social.openLink(`#challenge=${p}`), forged);
  await expect(page.getByTestId('challenge-card')).toContainText('does not carry a name this app makes');
});
