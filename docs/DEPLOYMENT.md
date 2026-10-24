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
| `ci.yml` | Every push and pull request | Job **checks**: lint; build (typecheck, Vite, **secret check**); unit tests; ingest tests (Python). Job **browser**, in three parallel shards: browser tests on the production build, at the root and under `/squib-dart-sim/` |
| `deploy.yml` | Push to `main`, or by hand | Build and test, then `tools/ci/publish-pages.sh`: replace the site on `gh-pages`, keep the live-data files, rebuild `live/index.json` |
| `live-data.yml` | :07 and :37 past each hour, 06–20 UTC; hourly 21–05 UTC | Runs `tools/ingest/weather.py`, `tide.py` and `index.py`, then `tools/ci/push-live-data.sh` |
| `tide-harmonics.yml` | Mondays 03:23 UTC, or by hand | `tools/ingest/harmonics.py`: derive the constants, validate them, write a year of HW/LW events |

**Why the browser tests run in three shards:**
- **No GPU:** GitHub's hosted runners have no GPU, so Chromium draws the 3D scene in software.
- **Two browsers starve each other:** with two at once, a page could take over 90 s just to show the instruments. That is how the first two CI runs failed.
- **The fix:**
  - each shard runs one browser;
  - time limits are doubled on CI;
  - a test is retried once, and one that passes only on retry is reported as **flaky**;
  - failures appear as annotations on the run (Playwright's GitHub reporter).

**How the live-data job pushes:**
- **Commits:** consecutive data commits are squashed into one ("Live data", amended and force-pushed with a lease), so `gh-pages` does not grow by 48 commits a day.
- **No races:** all jobs that push to `gh-pages` share one concurrency group.
- **When a source fails:** each script exits without writing, so the previously published file stays.
  - **Exit 3:** no new data; the job carries on.
  - **Exit 1:** an error; the job is marked failed.
  - **What users see:** the app judges the old file by its age (§4).

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
| **No secrets in the bundle.** `tools/check-secrets.ts` runs at the end of `npm run build` and scans every file in `dist/`, source maps included, for: <ul><li>known credential formats (AWS, GitHub, Google, Slack, Stripe, private keys, JWTs);</li><li>API-key headers with a value (the UKHO `Ocp-Apim-Subscription-Key`, `apikey`);</li><li>credential-looking values assigned to key, token, secret or password names;</li><li>**the exact values of secret-named environment variables present during the build** (in CI, any secret given to the job).</li></ul>It also refuses `VITE_*KEY/TOKEN/SECRET*` variables, which Vite would put into the client. Unit-tested in `tests/sim/secrets.test.ts` | `npm run build`, CI, Deploy |
| **The production build under a sub-path.** Assets, River Dart data, physics, controls, the polar worker, no fallback routing; live data present, stale, expired, corrupt, missing; live tide (`tests/e2e/deploy.spec.ts`, served by `tools/pages-server.mjs`) | `npm run test:e2e` |
| **Ingest parsing and validation.** <ul><li>EA and UKHO response shapes (synthetic fixtures);</li><li>the history CSVs;</li><li>the harmonic pipeline on a synthetic record;</li><li>weather range checks;</li><li>the index.</li></ul>The TypeScript tests read the same example `tide.json` the Python tests write | `python -I -m unittest discover -s tools/ingest -p 'test_*.py'`, `npm test` |

## 5. First run on GitHub: what to check

**Results of the first run (24 Oct 2026):**
1. **Log:** the job log could not be read from the development environment. The saved history shows the gauge worked: 191 readings over 48 h at 15-min steps, no gaps.
2. **Gauge values:** −1.54 to +2.14 m AOD, with two regular tides a day. Pass.
3. **UKHO:** no key set; not tested.
4. **Weather:** 9 wind steps (the 05:00 UTC run, 09:00–11:00) and 3 hourly sky readings. Pass.
5. **Harmonics:** need 36 days of history, so the first possible run is Monday 30 Nov 2026.

**No `tide.json` yet.** `tide.py` writes it only when there are predictions: from UKHO (needs the key) or from the harmonics (needs 36 days). Until then the app has no live tide. Manual tide and recorded snapshots still work.

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
