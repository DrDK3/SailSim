import { expect, test, type Page } from '@playwright/test';

/**
 * The training slice (docs/TRAINING_SLICE_REPORT.md): the instruments and the settings agree, and the two exercises
 * run end to end. Time is driven with the test hook window.__squib.advance(seconds), not the wall clock, so the
 * tests hold on slow software renderers.
 */

const CI_SLOW = process.env.CI ? 2 : 1;

async function ready(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?nowelcome&quality=low');
  await expect(page.getByTestId('stw')).toBeVisible();
  await page.waitForFunction(() => window.__squib!.controller.getState().dart.status !== 'loading', null, { timeout: 60_000 * CI_SLOW });
  return errors;
}

test('issue 198: after a restart with a Met Office replay, Options shows that source, as the instruments do', async ({ page }) => {
  test.setTimeout(240_000 * CI_SLOW);
  const errors = await ready(page);
  await expect.poll(() => page.evaluate(() => window.__squib!.controller.getState().weatherSources.filter((s) => s.kind === 'replay').length), { timeout: 60_000 * CI_SLOW }).toBeGreaterThan(0);
  const replay = await page.evaluate(() => window.__squib!.controller.getState().weatherSources.find((s) => s.kind === 'replay')!);
  await page.getByRole('button', { name: 'Options', exact: true }).click();
  let panel = page.getByRole('region', { name: 'Options' });
  await panel.locator('.field', { hasText: 'Source' }).locator('select').first().selectOption(replay.id);
  await panel.getByRole('button', { name: 'Apply and restart' }).click();
  await expect.poll(() => page.evaluate(() => window.__squib!.controller.scenario.conditions.weather.source), { timeout: 60_000 * CI_SLOW }).toBe('metoffice');
  // The instruments: the session's conditions come from the Met Office file.
  await expect.poll(() => page.evaluate(() => window.__squib!.controller.getState().envLabel), { timeout: 30_000 * CI_SLOW }).toContain('Met Office');
  // Options, opened again on the new session, shows the same file (it showed "Manual" before the fix).
  await page.getByRole('button', { name: 'Options', exact: true }).click();
  panel = page.getByRole('region', { name: 'Options' });
  await expect(panel.locator('.field', { hasText: 'Source' }).locator('select').first()).toHaveValue(replay.id);
  expect(errors).toEqual([]);
});

/** A learner inside the page: steers to TWA 45° (up to the luff in the cue phase), tacks in one turn, trims by status. */
async function sailAttempt(page: Page, opts: { stopWhen?: 'review' | 'tack' } = {}) {
  await page.evaluate((stopWhen) => {
    const sq = window.__squib!;
    const c = sq.controller;
    const R2D = 180 / Math.PI;
    let phaseKey = '';
    let sawLuff = false;
    let side0 = 0;
    const keys = ['helmRight', 'helmLeft', 'mainIn', 'mainOut', 'jibIn', 'jibOut'];
    for (let i = 0; i < 4000; i++) {
      const s = c.getState().exercise!.state;
      if (s.stage !== 'attempt') break;
      const ph = s.phase!.id;
      if (stopWhen === 'tack' && ph === 'tack') break;
      const sn = c.sim.snapshot(false);
      const key = `${s.attempt}|${ph}`;
      if (key !== phaseKey) {
        phaseKey = key;
        sawLuff = false;
        side0 = sn.mainSide;
      }
      const mainLuff = sn.forces.main.luff < 0.5;
      const jibLuff = sn.forces.jib.luff < 0.5;
      if (mainLuff || jibLuff) sawLuff = true;
      const twa = Math.abs(sn.twa) * R2D;
      const side = Math.sign(sn.twa) || 1;
      const up = side > 0 ? 'helmRight' : 'helmLeft';
      const down = side > 0 ? 'helmLeft' : 'helmRight';
      if (ph === 'tack' && sn.mainSide === side0) {
        c.press(up, true);
        c.press(down, false);
      } else {
        const err = twa - (ph === 'cue' && !sawLuff ? 20 : 45);
        c.press(up, err > 3);
        c.press(down, err < -3);
      }
      c.press('mainIn', !sn.input.autoMain && mainLuff);
      c.press('mainOut', !sn.input.autoMain && sn.forces.main.stall > 0.5);
      c.press('jibIn', !sn.input.autoJib && jibLuff);
      c.press('jibOut', !sn.input.autoJib && sn.forces.jib.stall > 0.5);
      sq.advance(0.1);
    }
    keys.forEach((k) => c.press(k, false));
  }, opts.stopWhen);
}

test('beginner exercise: an instructor link opens it; warm-up, attempts with graduated help, review, result split by assistance', async ({ page }) => {
  test.setTimeout(300_000 * CI_SLOW);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?nowelcome&quality=low&exercise=tack-recover');
  const panel = page.getByTestId('exercise');
  await expect(panel).toBeVisible({ timeout: 90_000 * CI_SLOW });
  await expect(page.getByTestId('exercise-title')).toHaveText('Try the controls (not scored)');
  await expect(page.getByTestId('exercise-status')).toContainText('Content: draft');
  await expect(page.getByTestId('exercise-status')).toContainText('provisional (E)');
  await panel.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByTestId('exercise-title')).toHaveText('Close-hauled');
  await expect(page.getByTestId('exercise-plan')).toContainText('Full assistance');
  await expect(page.getByTestId('exercise-assists')).toContainText('Assisted');

  // Attempt 1, sailed well: the review lists what happened.
  await sailAttempt(page);
  await expect(page.getByTestId('exercise-title')).toHaveText('Attempt 1: how it went');
  await expect(page.getByTestId('exercise-review')).not.toBeEmpty();
  await page.getByTestId('exercise-next').click();

  // Attempt 2: sail on across the wind instead of heading up; the help comes in levels, named in words.
  await expect(page.getByTestId('exercise-title')).toHaveText('Close-hauled');
  await page.evaluate(() => {
    const sq = window.__squib!;
    const c = sq.controller;
    for (let i = 0; i < 320; i++) {
      const sn = c.sim.snapshot(false);
      const err = (Math.abs(sn.twa) * 180) / Math.PI - 80;
      const side = Math.sign(sn.twa) || 1;
      c.press(side > 0 ? 'helmRight' : 'helmLeft', err > 3);
      c.press(side > 0 ? 'helmLeft' : 'helmRight', err < -3);
      sq.advance(0.1);
    }
    c.press('helmRight', false);
    c.press('helmLeft', false);
  });
  const help = page.getByTestId('exercise-help');
  await expect(help).toHaveAttribute('data-level', '3');
  await expect(help).toContainText('Try');
  await expect(help).toContainText('Turn the bow towards the wind');
  await sailAttempt(page);
  await page.getByTestId('exercise-next').click();

  // Attempts 3 and 4 skipped through: the result keeps assisted and independent apart, with the attempts' record.
  for (let a = 3; a <= 4; a++) {
    for (let i = 0; i < 4; i++) await panel.getByRole('button', { name: 'Skip step' }).click();
    await page.getByTestId('exercise-next').click();
  }
  await expect(page.getByTestId('exercise-title')).toContainText('done');
  await expect(page.getByTestId('result-assisted')).toContainText('Assisted attempts');
  await expect(page.getByTestId('result-independent')).toContainText('Independent attempts');
  await expect(page.getByTestId('exercise-attempts').locator('tbody tr')).toHaveCount(4);
  await expect(page.getByTestId('result-next')).toContainText('Next:');
  // The run is kept in this browser.
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('squib.exercises.records.v1') ?? '[]').length)).toBe(1);
  expect(errors).toEqual([]);
});
