# Deployment, live data and costs

This page covers:
- how the simulator is published;
- how live weather and tide reach it;
- what is checked automatically;
- what it costs.

**Status (24 Oct 2026): deployed.**
- **Repository:** [DrDK3/SailSim](https://github.com/DrDK3/SailSim) on GitHub, public.
- **Site:** Deploy published it on `gh-pages`. GitHub Pages is enabled (its build runs succeed). The site could not be opened from the development environment, whose network policy blocks github.io.
- **Live data:** the job runs on schedule.
- **First-run checks (§5):** done on 24 Oct; the results are below.
- **CI's browser tests:** they failed on GitHub's runners until they were split into three jobs (§3).

## 1. What is published

The simulator is a **static site**: HTML, JavaScript and data files. There is no server code and no database.

| Branch | Holds | Written by |
|---|---|---|
| `main` | Source code | You |
| `gh-pages` | The built site (`dist/`) plus live data in `live/` | **Deploy** (on every push to `main`) and **Live data** (every 30 min) |
| `tide-history` | Dartmouth gauge readings, one CSV per month, for the harmonic analysis | **Live data** |

- **Paths:** the build uses relative paths (`base: './'`), so the same files work at a domain root or under a GitHub Pages project path such as `https://<you>.github.io/squib-dart-sim/`. A browser test checks this under a sub-path.
- **What GitHub Pages serves:** the `gh-pages` branch as it is (a `.nojekyll` file turns off Jekyll).

### Live-data files (`live/` on `gh-pages`)

| File | Contents | Updated |
|---|---|---|
| `index.json` | The list of data files present (schema `squib-live-index/1`). The app reads it first, so it never asks for a file that is not there | With every change below |
| `latest.json` | Met Office UKV forecast, schema `squib-weather/2`: 10 m wind on a grid over the sailing area every 15 min for 2 h; hourly cloud, visibility, rain, fog, temperature and pressure; regional observations | Every 30 min (hourly overnight) |
| `latest.json` horizon | Each run publishes 8 hours of forecast: 15-minute steps for 2 hours, then hourly (GitHub runs the 30-minute schedule only every 4–6 hours). The job's time limit is 15 minutes. The app counts a forecast fresh while it covers now and the job ran within 8 hours | Same schedule |
| `tide.json` | Dartmouth tide: the last 48 h of EA gauge readings, and HW/LW predictions for the next 7 days. Predictions come from UKHO when a key is set, otherwise from our own harmonic predictions | Same schedule |
| `tide-predicted.json` | 400 days of HW/LW events predicted from harmonic constants derived from the gauge history. Labelled "derived from EA observations; not an official UKHO prediction" | Weekly, once there are 36 days of history |
| `tide-harmonics.json` | The constants, with their validation (RMS on 7 held-back days) | Weekly |
| `metoffice-replay-*.json` | Fixed recordings, built into every deployment | Never |

## 2. One-time setup on GitHub

1. **Repository:** create a repository and push this code to `main`. A public repository is recommended (§6).
2. **Deploy:** Actions → **Deploy** → *Run workflow*. This creates the `gh-pages` branch. Run it before the live-data job, which needs that branch.
3. **Pages:** Settings → Pages → *Deploy from a branch* → `gh-pages`, folder `/ (root)`.
4. **Workflow permissions:** Settings → Actions → General → Workflow permissions: *Read and write*. The jobs push to `gh-pages` and `tide-history`.
5. **Optional UKHO key** for official tide predictions:
   - Subscribe to the free **ADMIRALTY UK Tidal API – Discovery** tier.
   - Add the key as an Actions secret named `UKHO_API_KEY`.
   - Only the live-data job reads it. It is never in the site, and the build fails if a secret's value appears in it (§4).
6. **Scheduled workflows:** check that **Live data** and **Tide harmonics** are enabled. GitHub disables schedules in repositories with no activity for 60 days.

## 3. The workflows (`.github/workflows/`)

| Workflow | When | What |
|---|---|---|
| `ci.yml` | Every pull request and every push to `main` (a branch is tested through its pull request, or by hand: Actions → CI → Run workflow) | Job **checks**: lint; build (typecheck, Vite, **secret check**); unit tests; ingest tests (Python). Job **browser**, in four parallel shards: browser tests on the production build, at the root and under `/squib-dart-sim/` |
| `deploy.yml` | Push to `main`, or by hand | Job **verify**: build (typecheck, Vite, secret check), unit tests, then the **critical browser checks** (`playwright.critical.config.ts`) on that same build; the build is kept as the `site-dist` artifact and the results as `critical-checks` (with the build and environment in the run's summary). Job **publish**, only if verify passed: `tools/ci/publish-pages.sh` on that artifact (no second build): replace the site on `gh-pages`, keep the live-data files, rebuild `live/index.json` |
| `live-data.yml` | :07 and :37 past each hour, 06–20 UTC; hourly 21–05 UTC | Runs `tools/ingest/weather.py`, `tide.py` and `index.py`, then `tools/ci/push-live-data.sh` |
| `tide-harmonics.yml` | Mondays 03:23 UTC, or by hand | `tools/ingest/harmonics.py`: derive the constants, validate them, write a year of HW/LW events |
| `post-deploy-check.yml` | After each successful deploy, every Monday at 06:00 London time, or by hand | `tools/post-deploy-check.mjs` in Playwright against the live site: it reaches a sailable state, the social card and the manifest return 200, `landing.html` loads; on Mondays `weekly/` holds this week's targets. Reads only (below) |

**The release gate (design handover item 9, 23 Nov 2026):** a commit reaches `gh-pages` only if, for that exact
commit, the build, the unit tests and the critical browser checks passed, and what is published is the build that was
checked (an artifact handed from **verify** to **publish**). The critical set is the tests tagged `{ tag: '@critical' }`:
the app reaching a sailable state, keyboard helm and sheets, an on-screen steering button from the keyboard, a lesson to
its result card, a race against AI boats to its results, and a failed save giving its notice. `tests/sim/releaseGate.test.ts`
holds the order of the steps and the coverage. To add a flow to the set, tag its test; keep the set small (each test
takes one to three minutes on a runner without a GPU). The full suite still runs in CI on every pull request, and the
post-deploy check still runs after each deploy. Run the set locally with `npm run build && npx playwright test -c
playwright.critical.config.ts`.

Tests that encode a superseded product policy are updated with the policy, not kept: in this round, the lesson result
test (skipping no longer completes a lesson), the Learn map test ("Back to it" for the activity under way) and the
debrief-notes test (no cause without a recorded basis).

**Why the browser tests run in five shards:**
- **No GPU:** GitHub's hosted runners have no GPU, so Chromium draws the 3D scene in software.
- **Two browsers starve each other:** with two at once, a page could take over 90 s just to show the instruments. That is how the first two CI runs failed.
- **The fix:**
  - each shard runs one browser;
  - time limits are doubled on CI;
  - a test is retried once, and one that passes only on retry is reported as **flaky**;
  - failures appear as annotations on the run (Playwright's GitHub reporter).
- **The scene keeps growing:** with the marinas and the railway (27 Oct 2026) the slowest of three shards took 35–45 minutes, against a 45-minute limit. Now four shards split by test (`fullyParallel`; by file, one shard had 23 tests and another none) with a 60-minute limit, and on a software renderer the app draws the berthed boats' detailed models only within 150 m and the sleepers only at Kingswear station (`?quality=low` does the same on a real GPU). On 21 Nov 2026 the next round's tests took the slowest of the four shards past the hour (cancelled at 60 minutes): five shards now.

**How the live-data job pushes:**
- **Commits:** consecutive data commits are squashed into one ("Live data", amended and force-pushed with a lease), so `gh-pages` does not grow by 48 commits a day.
- **No races:** all jobs that push to `gh-pages` share one concurrency group.
- **When a source fails:** each script exits without writing, so the previously published file stays.
  - **Exit 3:** no new data; the job carries on.
  - **Exit 1:** an error; the job is marked failed.
  - **What users see:** the app judges the old file by its age (§4).

### The post-deploy check (fixes of 21 Nov 2026, §3.7)

`post-deploy-check.yml` looks at the published site from outside, as a visitor's browser would. It writes nothing to `gh-pages` or anywhere else (its token can only read the repository); a failed check fails the workflow run, so GitHub notifies the owner as it does for any failed workflow, and the run's summary lists each check.

- **When:** after each deploy that succeeded (`workflow_run` on Deploy); every Monday at 06:00 in London; or by hand (Actions → Post-deploy check → Run workflow, with "also check weekly/" if wanted).
  - GitHub's schedules are in UTC, so two are set, 05:00 and 06:00 UTC on Mondays, and the job goes on only for the one that is 06:00 in London that day (05:00 UTC in summer time, 06:00 UTC in winter).
  - GitHub may start a scheduled run some minutes late. The Monday run comes after the weekly-targets job (02:23 UTC).
  - `workflow_run` and `schedule` workflows run only from the default branch: the check starts working once this file is on `main`.
- **After a deploy it waits for the new build:** GitHub Pages publishes a minute or two after the deploy job ends. The check reads the build the site serves (the commit the app names in its graphics report) and reloads once a minute, for up to 15 minutes, until it is the deployed commit; then it checks.
- **What it checks:**
  1. The app loads at `?nowelcome&quality=low`, the instruments show, the River Dart data loads, and 3 s of sailing (`window.__squib.advance`) move the boat, with no page errors.
  2. `social-card.jpg` returns 200 as a JPEG; `manifest.webmanifest` returns 200 as JSON, and each icon it lists returns 200 as an image.
  3. `landing.html` returns 200 and its hero image is drawn.
  4. Mondays (and by hand when asked): `weekly/<this week>.json` returns 200 and is that week's targets. The week is the ISO week of the date in London, as the app and the weekly-targets job reckon it (`tools/post-deploy-week.mjs`, held to `src/app/weekly.ts` by `tests/sim/postDeployWeek.test.ts`).
- **Which site:** the repository's Pages address (`https://<owner>.github.io/<repo>/`), or the repository variable `SITE_URL` if set (Settings → Secrets and variables → Actions → Variables), for a custom address.
- **Run it locally:** `SITE_URL=https://drdk3.github.io/SailSim/ CHECK_WEEKLY=1 node tools/post-deploy-check.mjs` (or against `npx vite preview`).
- **Cost:** free (GitHub Actions minutes; about 3–5 minutes a run: installing Chromium, then one page load in software).

### Videos: GitHub Releases, not the repository

The trailer (`public/media/trailer.mp4`, 0.9 MB) is in the repository already and stays (history is not rewritten). Future videos go to a GitHub Release as release assets (free, kept out of every clone) and are linked from the landing page by the release's download address; still images stay in `public/media/`.

## 4. What the app does with live data, and the automatic checks

### Freshness rules (`src/sim/env/liveData.ts`)

All thresholds are estimates (E), chosen for sessions of about an hour.

| Situation | Weather | Tide |
|---|---|---|
| **Fresh** | The forecast covers now (to its last 15-min step + 15 min) and the job ran within 90 min | Predictions cover now. The gauge reading is ≤ 60 min old, so the measured surge is applied |
| **Stale** | Up to 6 h past the end of the forecast, or the job is late. Offered as "Live (stale)" with a warning in the Scenario panel | Gauge reading older than 60 min: predictions only, no surge |
| **Expired** | Over 6 h past the end. Offered only as "Recorded …" | Predictions do not cover now: offered only as a recording |
| **Missing or corrupt** | Not offered; the reason is listed in the Scenario panel. Replays and manual conditions still work | Same |
| **No `index.json`** | The bundled replays are offered | No tide file |

**Using a live forecast:**
- **Wind:** with a live forecast the wind **follows the 15-minute forecast steps**, interpolated in time. After the last step it holds.
- **Sky:** cloud, visibility and rain follow the hourly sky fields. They are visual only.
- **Reproducibility:** a session started from live data records the snapshot it used, so it can be replayed exactly.

### Automatic checks

| Check | Where |
|---|---|
| **No secrets in the bundle.** `tools/check-secrets.ts` runs at the end of `npm run build` and scans every file in `dist/`, source maps included, for: <ul><li>known credential formats (AWS, GitHub, Google, Slack, Stripe, private keys, JWTs);</li><li>API-key headers with a value (the UKHO `Ocp-Apim-Subscription-Key`, `apikey`);</li><li>credential-looking values assigned to key, token, secret or password names;</li><li>**the exact values of secret-named environment variables present during the build** (in CI, any secret given to the job).</li></ul>It also refuses `VITE_*KEY/TOKEN/SECRET*` variables, which Vite would put into the client. One name is exempt from both rules, by exact name and with the owner's approval: `VITE_TURNSTILE_SITEKEY`, a Cloudflare Turnstile site key, which is public by design (its secret key, `TURNSTILE_SECRET`, stays in the club-table Worker). The list is `PUBLIC_BY_DESIGN` in `tools/secrets.ts`. Unit-tested in `tests/sim/secrets.test.ts` | `npm run build`, CI, Deploy |
| **The production build under a sub-path.** Assets, River Dart data, physics, controls, the polar worker, no fallback routing; live data present, stale, expired, corrupt, missing; live tide (`tests/e2e/deploy.spec.ts`, served by `tools/pages-server.mjs`) | `npm run test:e2e` |
| **Ingest parsing and validation.** <ul><li>EA and UKHO response shapes (synthetic fixtures);</li><li>the history CSVs;</li><li>the harmonic pipeline on a synthetic record;</li><li>weather range checks;</li><li>the index.</li></ul>The TypeScript tests read the same example `tide.json` the Python tests write | `python -I -m unittest discover -s tools/ingest -p 'test_*.py'`, `npm test` |

## 5. First run on GitHub: what to check

**Results of the first run (24 Oct 2026):**
1. **Log:** the job log could not be read from the development environment. The saved history shows the gauge worked: 191 readings over 48 h at 15-min steps, no gaps.
2. **Gauge values:** −1.54 to +2.14 m AOD, with two regular tides a day. Pass.
3. **UKHO:** no key set; not tested.
4. **Weather:** 9 wind steps (the 05:00 UTC run, 09:00–11:00) and 3 hourly sky readings. Pass.
5. **Harmonics:** need 36 days of history, so the first possible run is Monday 30 Nov 2026.

**No `tide.json` yet.** `tide.py` writes it only when there are predictions: from UKHO (needs the key) or from the harmonics (needs 36 days; the gauge record began on 24 Oct 2026, so about 30 Nov 2026 at the earliest). Until then the app has no live tide: a live quick race on the river runs without a tidal stream and says so. Manual tide and recorded snapshots still work.

The checks, for this or a later run:

1. **Log:** the job log should show `EA gauge: N readings, latest …` with N about 190 for 48 h. If it shows an error, compare the EA response with `ea_tidal_measure` and `ea_readings` in `tools/ingest/tide.py`.
2. **Gauge values:** open `live/tide.json` on the site. Gauge `mAOD` values at Dartmouth should lie between about −3 and +3.
   - The chart-datum offset (2.62 m) is still provisional: MISSING_INFORMATION C8.
3. **UKHO, if a key is set:**
   - **Station:** the source names a station id. Compare one HW time and height with ADMIRALTY EasyTide for Dartmouth.
   - **Time zone:** the code assumes UKHO times are UTC. If they are local time, HW will be an hour out in summer.
4. **Weather:** `live/latest.json` should list 9 wind steps. This part was tested against the real Met Office feed on 23 Oct 2026.
5. **Harmonics:** after 36 days, the **Tide harmonics** job writes `live/tide-harmonics.json`. Check that `validation.rms_m` is small, within a few centimetres plus the surge on those days. A harmonic prediction cannot include surge.

## 6. Costs

| Item | Cost |
|---|---|
| **GitHub Pages** hosting | Free. Limits: site up to 1 GB, 100 GB a month of bandwidth (soft), 10 branch builds an hour (soft). This site is about 7 MB, and the live data adds at most 2 pushes an hour plus deploys ([GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)) |
| **GitHub Actions, public repository** | Free on standard runners ([how Actions use is measured](https://docs.github.com/en/billing/concepts/product-billing/github-actions)) |
| **GitHub Actions, private repository** | Included minutes: 2,000 a month on GitHub Free, 3,000 on Pro. The live-data schedule is 39 runs a day of about 1.5 min, rounded up to 2 min each, so about **2,340 min a month** on its own. CI with browser tests uses about 10 min per push. **A private repository therefore needs a paid plan, or a sparser schedule.** Publishing Pages from a private repository also needs a paid plan ([GitHub's plans](https://docs.github.com/en/get-started/learning-about-github/githubs-plans); current prices: github.com/pricing) |
| **Met Office** UKV and observations (AWS Open Data) | Free; CC BY-SA 4.0 (attribution shown in the app) |
| **Environment Agency** gauge | Free; Open Government Licence v3 |
| **UKHO ADMIRALTY UK Tidal API** | Discovery tier free (7 days ahead; renew yearly). Foundation about £120 a year, Premium about £300 a year (docs/LIVE_TIDES.md). **Optional:** without a key the app uses predictions derived from the EA gauge |
| **Custom domain** | Optional, about £10 a year |
| **Servers, databases, proxies** | None. The UKHO key stays in the CI job, so no key proxy is needed in the browser |

**Recommended:** a public repository on GitHub Free. **Running cost: £0.** Optional extras: a custom domain, and the paid UKHO tiers.

**Alternative host:** Cloudflare Pages (free tier) works for the static site. However, its Git integration would rebuild on every live-data commit, which is over its monthly build allowance. Use its direct upload (an API token as a CI secret) and keep the live data on GitHub Pages or object storage. Not set up here.

## 6a. Racing other people: what works now, and what would need a server

**Works now, at no cost (no server):** a run shared as a link (Scenarios and replays → "Copy a link to race this run", or "Challenge a friend" in the race results; `src/app/shareLink.ts`). The whole replay is compressed into the link after the `#`, which browsers do not send to the web server, so GitHub Pages never sees it. Whoever opens the link races that run as a ghost in their own browser, in the same scenario (today's challenge included). A ten-minute race makes a link of a few tens of thousands of characters: fine to copy, paste and email; some messaging apps may cut very long links, and then the replay file (Scenarios and replays → Save replay) does the same job.

**Would need a server (not built; an owner decision):**

| Feature | What it needs |
|---|---|
| Live racing against other people at the same time | A real-time relay or game server (WebSocket or WebRTC with a signalling server) running all the time, and a way to keep the boats in step over the internet |
| Shared leaderboards (today's challenge, course records) | A database and a small web API to receive and check results, with protection against faked times (for example re-running each submitted replay on the server) |
| Accounts or names on leaderboards | Sign-in or a name store, and somewhere to keep it |
| Any of the above | A privacy notice saying what is collected and kept, why and for how long, and how to have it removed (UK GDPR); moderation of names; someone to run and pay for it |

These are paid or quota-limited services (a hosted database or serverless functions, a real-time service, or a small server), whose prices change: check the provider's current pricing before choosing. GitHub Pages alone cannot do any of them, since it serves fixed files only.

## 6b. Weekly course targets (juniors round; no server)

`.github/workflows/weekly-targets.yml` runs early every Monday (02:23 UTC, after midnight in London in summer and in winter) and again at 14:23 UTC, or by hand. It builds the headless tools (`npm run tools:build`: Vite bundles `tools/weekly-targets.ts` with the app's own code into `dist-tools/`), sails the week's course with the AI at the club, good and expert levels over three seeds, and writes `weekly/<week>.json` (bronze, silver and gold target times with a ghost track each) on `gh-pages`, next to `live/`, with the same temporary-file-and-rename and squashed-commit pattern (`tools/ci/push-site-data.sh`). A deploy keeps `weekly/` and `club/` (`tools/ci/publish-pages.sh`). Four weeks of files are kept.

- No secrets, no cost beyond GitHub Actions minutes (about 1 minute for a practice course, about 1–2 minutes for an RDYC course: the AI takes about 52 minutes of simulated time to sail RDYC C1, which the headless sim does in under 15 s per run).
- If it fails or has not run, the app builds the week's course itself (`src/app/weekly.ts`) and says "targets not available this week".
- Run it locally: `npm run weekly:targets -- out/weekly [--at 2026-11-17T12:00:00Z] [--seeds 1,2,3]`.
- Optional: `data/weekly/season.json` (`{ "weeks": { "2026-W48": "rdyc-2026-c1", "2026-W49": "practice:triangle" } }`) sets the courses of chosen weeks; other weeks follow the rotation. Nothing needs editing weekly.

## 6c. Club table (optional, off by default)

The club table (juniors round §6.4) is the **one** server-side piece this project allows: a single small endpoint on a free hosting tier, extending decision D8. **It is not deployed and no account was created.** Until the owner does the steps below, the app shows no club table, makes no request for one, and the scheduled job does nothing.

**Recommended provider: Cloudflare Workers with Workers KV** (free limits checked 17 Nov 2026 on Cloudflare's pages, and re-check them when you set it up):

| | Cloudflare Workers + KV (recommended) | Supabase (compared) |
|---|---|---|
| Free allowance | Workers: 100,000 requests a day. KV: 100,000 reads, 1,000 writes, 1,000 deletes and 1,000 lists a day, 1 GB stored; limits reset at 00:00 UTC | 500 MB database per project, 2 active projects |
| What happens at a limit | That day's further writes (submissions) fail with an error until 00:00 UTC; the app says the table could not be reached; nothing else is affected | Projects on the free plan are **paused after a week without activity** and must be restarted by hand from the dashboard: wrong for a weekly table that may be quiet in winter |
| Bot check | Cloudflare Turnstile, free (up to 20 widgets an account; its Privacy Addendum must be referred to in the privacy notice) | Would need a separate provider |
| Fits the code | `server/club-table/worker.js` as written (one file, no framework, no build step) | Would need an adapter (Postgres via its REST API) |

A club's juniors submitting a few runs a week use well under 1% of these allowances. **Expected cost: £0 a month within the free limits.**

**What the owner sets up, once (about 30 minutes):**

1. Create a Cloudflare account (the owner's or the club's; not a junior's). In Workers & Pages create a KV namespace, for example `sailsim-club`.
2. Create a Worker from `server/club-table/worker.js` (paste the file in the dashboard editor, or `npx wrangler deploy server/club-table/worker.js` with a `wrangler.toml` naming the KV binding). Bind the namespace as **`CLUB`**. Add the variable `ALLOWED_ORIGIN` = the site's origin (`https://drdk3.github.io`).
3. Add two **secrets** to the Worker: `ADMIN_TOKEN` (a long random string: `openssl rand -hex 32`) and, for the bot check, `TURNSTILE_SECRET` (from a Turnstile widget created for the site's hostname; its site key is public).
4. In the GitHub repository: **Settings → Secrets and variables → Actions**: secrets `CLUB_TABLE_URL` (the Worker's address) and `CLUB_ADMIN_TOKEN` (the same admin token); variables `CLUB_TABLE_ENABLED` = `true`, optionally `CLUB_SEASON_WEEKS` (default 26), and for the build `VITE_CLUB_TABLE_URL` (the Worker's address) and `VITE_TURNSTILE_SITEKEY` (the public site key). Then add these two to the build step's `env:` in `deploy.yml` (`VITE_CLUB_TABLE_URL: ${{ vars.VITE_CLUB_TABLE_URL }}`, `VITE_TURNSTILE_SITEKEY: ${{ vars.VITE_TURNSTILE_SITEKEY }}`): the agent did not change `deploy.yml`.
5. Read and finish the draft notes ([docs/club-table/DATA_PROTECTION.md](club-table/DATA_PROTECTION.md), [docs/club-table/PARENTS.md](club-table/PARENTS.md)) and link the parents' note from the club's website before switching it on.

**What then runs with no person involved:** `.github/workflows/club-table.yml` every 30 minutes (minutes 7 and 37, as the live data): fetch pending runs → re-sail each with the simulator → verdict stored where the submitter's token can read it → replay deleted (the week's top three kept as ghosts) → removals applied → entries older than the season deleted → `club/weekly-<week>.json` and its ghosts published on `gh-pages`. The verifiers of the last five builds are kept on the branch `club-verifiers`, so a run recorded just before a deploy is still checked by the build that recorded it; older ones are marked "unverifiable" with that reason.

**Switching it off:** set `CLUB_TABLE_ENABLED` to `false` (the job stops) and remove `VITE_CLUB_TABLE_URL` (the next deploy hides the table). Deleting the Worker and the KV namespace removes everything stored.

**Locally:** `npm run club:mock` (the same handler over memory, http://localhost:8787, admin token `local-admin-token`), and `CLUB_TABLE_URL=http://localhost:8787 CLUB_ADMIN_TOKEN=local-admin-token npm run club:verify -- --site out/site`.

## 7. How this was tested without GitHub

The full flow was rehearsed against a local bare repository standing in for GitHub (23 Oct 2026):
- **First deploy:** `publish-pages.sh` created `gh-pages`.
- **Live data:** a real `latest.json` (Met Office, written by `weather.py` that afternoon) was pushed twice by `push-live-data.sh`. The second push amended the first.
- **Second deploy:** it kept the live file, and `index.json` listed it and both bundled replays.
- **Serving:** the resulting `gh-pages` tree, served under `/squib-dart-sim/` by `tools/pages-server.mjs`, offered "Live: Met Office UKV, from 2026-10-23T14:00Z: forecast covers now", with no console errors.
- **Linting:** the workflows pass `actionlint`, and the scripts pass `shellcheck`.

To repeat the rehearsal:
```bash
npm run build
python -I tools/ingest/weather.py /tmp/latest.json   # needs network access to the Met Office bucket
node tools/pages-server.mjs 4174 squib-dart-sim dist  # then open http://localhost:4174/squib-dart-sim/
```
