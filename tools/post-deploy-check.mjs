/**
 * Is the live site working? (fixes of 21 Nov 2026, §3.7; docs/DEPLOYMENT.md §3.) Run by
 * .github/workflows/post-deploy-check.yml after each deploy and every Monday at 06:00 London time. It only reads:
 * nothing is written to gh-pages or anywhere else. Any failed check makes the run fail (exit 1), with a list of what
 * failed in the log and the run's summary.
 *
 *   SITE_URL=https://drdk3.github.io/SailSim/ [EXPECT_BUILD=<commit>] [CHECK_WEEKLY=1] node tools/post-deploy-check.mjs
 *
 * Checks:
 * - the app loads and reaches a sailable state: the instruments show, the River Dart data loads, and 3 s of sailing
 *   advance the boat, with no page errors (with EXPECT_BUILD, it first waits until the site serves that commit's
 *   build, since GitHub Pages publishes a minute or two after the deploy job ends);
 * - the social card and the web manifest (and its icons) return 200;
 * - landing.html loads, with its hero image drawn;
 * - with CHECK_WEEKLY=1 (the Monday run): weekly/<this week>.json is there and is this week's targets.
 */
import { chromium } from '@playwright/test';
import { appendFileSync, existsSync } from 'node:fs';
import { londonIsoWeek, siteUrl } from './post-deploy-week.mjs';

const SITE = siteUrl();
const EXPECT_BUILD = process.env.EXPECT_BUILD || '';
const CHECK_WEEKLY = process.env.CHECK_WEEKLY === '1';
/** How long to wait for GitHub Pages to serve the new build (s). */
const WAIT_S = Number(process.env.WAIT_S ?? 900);
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const exe = process.env.PW_CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const request = context.request;

/** Load the app; returns the page, its build and the errors it threw (or a reason it did not load). */
async function loadApp() {
  const page = await context.newPage();
  page.setDefaultTimeout(240_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const res = await page.goto(`${SITE}?nowelcome&quality=low`);
  if (!res || res.status() !== 200) return { page, errors, failed: `the page returned ${res?.status() ?? 'nothing'}` };
  try {
    await page.getByTestId('stw').waitFor({ state: 'visible', timeout: 240_000 });
  } catch {
    return { page, errors, failed: 'the instruments did not show within 4 minutes' };
  }
  const build = await page.evaluate(() => /Build: (\S+)/.exec(window.__squib.controller.materialReport())?.[1] ?? '');
  return { page, errors, build };
}

// 1. The app, sailable (after waiting for this deploy's build, when one is expected).
const t0 = Date.now();
let app = await loadApp();
while (EXPECT_BUILD && !app.failed && !app.build.endsWith(EXPECT_BUILD) && Date.now() - t0 < WAIT_S * 1000) {
  console.log(`the site serves ${app.build}, not ${EXPECT_BUILD} yet: waiting`);
  await app.page.close();
  await new Promise((r) => setTimeout(r, 60_000));
  app = await loadApp();
}
if (app.failed) check('The app loads', false, app.failed);
else {
  check('The app loads', true, app.build);
  if (EXPECT_BUILD) check('The site serves this deploy’s build', app.build.endsWith(EXPECT_BUILD), `${app.build}, expected …${EXPECT_BUILD}`);
  const dart = await app.page
    .waitForFunction(() => window.__squib.controller.getState().dart.status !== 'loading', null, { timeout: 240_000 })
    .then(() => app.page.evaluate(() => window.__squib.controller.getState().dart.status))
    .catch(() => 'still loading after 4 minutes');
  check('The River Dart data loads', dart === 'loaded', dart);
  const sail = await app.page.evaluate(() => {
    const a = window.__squib.snapshot();
    window.__squib.advance(3);
    const b = window.__squib.snapshot();
    return { dt: b.t - a.t, moved: Math.hypot(b.n - a.n, b.e - a.e), stw: b.stw };
  });
  check('It sails: 3 s advance the boat', Math.abs(sail.dt - 3) < 0.05 && Number.isFinite(sail.stw) && sail.moved > 0.1, `${sail.dt.toFixed(2)} s, ${sail.moved.toFixed(1)} m`);
  check('No page errors', app.errors.length === 0, app.errors.slice(0, 3).join(' | '));
}

// 2. The social card and the manifest (and its icons).
const card = await request.get(`${SITE}social-card.jpg`);
check('social-card.jpg returns 200', card.status() === 200 && /image\/jpeg/.test(card.headers()['content-type'] ?? ''), `${card.status()} ${card.headers()['content-type'] ?? ''}`);
const man = await request.get(`${SITE}manifest.webmanifest`);
/** A JSON response's body, or null when it is not a 200 or not JSON. */
async function json(r) {
  try {
    return r.status() === 200 ? JSON.parse(await r.text()) : null;
  } catch {
    return null;
  }
}
const manifest = await json(man);
check('manifest.webmanifest returns 200 (valid JSON)', !!manifest?.name, `${man.status()}`);
for (const icon of manifest?.icons ?? []) {
  const r = await request.get(new URL(icon.src, `${SITE}manifest.webmanifest`).href);
  check(`Manifest icon ${icon.src} returns 200`, r.status() === 200 && /^image\//.test(r.headers()['content-type'] ?? ''), `${r.status()} ${r.headers()['content-type'] ?? ''}`);
}

// 3. The landing page, its hero drawn.
const landing = await context.newPage();
const lr = await landing.goto(`${SITE}landing.html`);
const hero = lr?.status() === 200 ? await landing.evaluate(async () => {
  // The hero: the first figure's image.
  const img = document.querySelector('figure img');
  if (!img) return 0;
  if (!img.complete)
    await new Promise((r) => {
      img.addEventListener('load', r, { once: true });
      setTimeout(r, 30_000);
    });
  return img.naturalWidth;
}) : 0;
check('landing.html loads, its hero image drawn', lr?.status() === 200 && hero > 0, `${lr?.status() ?? 'no response'}, hero ${hero} px wide`);

// 4. Monday: this week's targets.
if (CHECK_WEEKLY) {
  const week = londonIsoWeek();
  const w = await request.get(`${SITE}weekly/${week}.json`);
  const file = await json(w);
  check(`weekly/${week}.json is this week’s targets`, file?.week === week && Array.isArray(file.targets) && file.targets.length > 0, `${w.status()}${file ? `, week ${file.week}, ${file.targets?.length ?? 0} targets` : ''}`);
}

await browser.close();
const failed = results.filter((r) => !r.ok);
const summary = [`## Post-deploy check of ${SITE}`, '', '| Check | Result | Detail |', '|---|---|---|', ...results.map((r) => `| ${r.name} | ${r.ok ? 'pass' : '**FAIL**'} | ${r.detail.replace(/\|/g, '/')} |`)].join('\n');
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
console.log(failed.length ? `\n${failed.length} check(s) failed.` : '\nAll checks passed.');
process.exit(failed.length ? 1 : 0);
