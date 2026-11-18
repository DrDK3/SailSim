import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';

/**
 * Juniors round, layer B end to end against the local mock endpoint (server/club-table/mock.mjs), with no manual step:
 * a weekly run is submitted from the app → the verifier (dist-tools/club-verify.mjs, the scheduled Action's script)
 * re-sails it in Node and publishes the table into the site → the table appears in the app → "Remove my entry" → the
 * next verifier run removes it → it disappears. The run is recorded in Chromium and re-sailed in Node: both V8.
 * The AI is put on the player's helm (a test hook) so the course is finished without hours of software rendering.
 */
const CI_SLOW = process.env.CI ? 2 : 1;
const verify = () =>
  execFileSync(process.execPath, ['dist-tools/club-verify.mjs', '--site', 'dist-club'], {
    env: { ...process.env, CLUB_TABLE_URL: 'http://localhost:8787', CLUB_ADMIN_TOKEN: 'e2e-admin-token' },
    encoding: 'utf8',
    timeout: 300_000,
  });

test('submit → verify → publish → shown → remove → gone, with no person involved', async ({ page }) => {
  test.setTimeout(600_000 * CI_SLOW);
  const hosts = new Set<string>();
  page.on('request', (r) => hosts.add(new URL(r.url()).host));
  await page.goto('/?nowelcome&quality=low');
  await page.waitForFunction(() => window.__squib!.controller.getState().dart.status !== 'loading', null, { timeout: 120_000 * CI_SLOW });
  // Before any submission: the flag is on, so the card looks for the table (a static file on the site).
  const finished = await page.evaluate(() => {
    const c = window.__squib!.controller;
    c.social.sailWeekly();
    window.__squib!.aiHelm('good');
    for (let i = 0; i < 1300 && !c.getState().social.finish; i++) window.__squib!.advance(5);
    return c.getState().social.finish;
  });
  expect(finished, 'the AI finished the weekly course').toBeDefined();
  const submit = page.getByTestId('club-submit');
  await expect(submit).toBeVisible({ timeout: 60_000 * CI_SLOW });
  await expect(submit).toContainText('no real name, no account, no location');
  await submit.getByTestId('club-submit-button').click();
  await expect(page.getByTestId('club-submit-state')).toContainText('Sent', { timeout: 60_000 * CI_SLOW });
  const name = await page.evaluate(() => window.__squib!.controller.social.name);

  const out1 = verify();
  console.log(`[club verifier] ${out1.trim()}`);
  expect(out1).toMatch(/: accepted/);
  // The table is a static file on the site now.
  const week = await page.evaluate(() => window.__squib!.controller.social.ui().weekly.week);
  const table = await (await page.request.get(`/club/weekly-${week}.json`)).json();
  expect(table.entries.map((e: { name: string }) => e.name)).toContain(name);
  expect(Object.keys(table.entries[0]).sort()).toEqual(['category', 'date', 'name', 'timeS']);
  expect(table.ghosts.length).toBe(1);
  // Shown in the app.
  await page.reload();
  await page.waitForFunction(() => window.__squib!.controller.getState().dart.status !== 'loading', null, { timeout: 120_000 * CI_SLOW });
  await page.getByRole('button', { name: 'Race', exact: true }).click();
  const club = page.getByTestId('club-table');
  await expect(club).toContainText(name, { timeout: 60_000 * CI_SLOW });
  await expect(club).toContainText('Beat the club');
  // Remove my entry: asked now, done by the next verifier run.
  await club.getByTestId('club-remove').click();
  await expect(club.getByTestId('club-mine')).toContainText('removal asked for');
  expect(verify()).toMatch(/removed the entry/);
  const after = await (await page.request.get(`/club/weekly-${week}.json`)).json();
  expect(after.entries.map((e: { name: string }) => e.name)).not.toContain(name);
  await page.reload();
  await page.waitForFunction(() => window.__squib!.controller.getState().dart.status !== 'loading', null, { timeout: 120_000 * CI_SLOW });
  await page.getByRole('button', { name: 'Race', exact: true }).click();
  await expect(page.getByTestId('club-table')).not.toContainText(name, { timeout: 60_000 * CI_SLOW });
  // Only the site and the club endpoint were contacted.
  expect([...hosts].every((h) => h === 'localhost:4175' || h === 'localhost:8787')).toBe(true);
});
