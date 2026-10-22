# Live weather conditions: findings and proposed design

- **Added:** 22 Oct 2026, at the user's request for real-time weather.
- **Status:** feasibility proven with a working script (`research/weather/live_conditions.py`). Not yet in the simulator.

## 1. What "real-time" can honestly mean on the Dart

I found **no public anemometer on the River Dart** (searched for RDYC, DHNA, Kingswear and Dartmouth). So the realistic options are a regional measurement or a local forecast model. The app will always show which one is in use, its valid time and its age.

| Source | Kind | Covers the Dart? | Latency | Gusts | Access | Licence | Tested here |
|---|---|---|---|---|---|---|---|
| **Met Office UKV 2 km** model (AWS Open Data) | Forecast, 15-min steps | **Yes**: a 2 km grid. RDYC, the entrance and the Dittisham reach fall in separate cells | Run available 3–6 h after model time; I use the newest run covering *now* | Yes | Public S3, no key | CC BY-SA 4.0 (Crown copyright) | **Yes** |
| **Met Office land observations** (AWS Open Data) | **Measured**, 1-min means | No. Nearest stations are Plymouth Mountbatten (38.8 km) and Exeter Airport (45.1 km) | Hourly batches, about 1–2 h behind | **No gust field** | Public S3, no key | CC BY-SA 4.0 | **Yes** |
| Open-Meteo (`api.open-meteo.com`) | Model blend incl. UKV; a "current" value from 15-min data | Yes (any point) | Near real time, but the Met Office open data it uses has an extra ~4 h delay (per Open-Meteo docs) | Yes | Browser-direct, no key | CC BY 4.0; free for **non-commercial** use only | No (host blocked here) |
| Met Office DataHub site-specific API | Forecast | Yes (point) | Near real time | Yes | **API key**, so it needs a server proxy. Free tier: 360 calls/day | Met Office terms | No (host blocked) |
| A **local station** at RDYC or DHNA (if one exists, e.g. Davis or WeatherFlow) | **Measured, local** | **Yes** | Seconds to minutes | Yes | Depends on the vendor's API | Owner's permission | Unknown. **Please tell me if one exists** |

## 2. Snapshot taken during this session (22 Oct 2026)

*Illustrative only. Not for navigation.*

**Model:** UKV run 03:00Z, valid 07:15Z (forecast lead 4 h 15 min).

| Point | Wind from | Mean | Gust |
|---|---|---|---|
| RDYC, Kingswear | 267° | 10.6 kn | 18.2 kn |
| Dart entrance | 270° | 11.2 kn | 16.6 kn |
| Start Bay offshore | 270° | 15.7 kn | 20.0 kn |
| Dittisham reach | 258° | 10.3 kn | 17.6 kn |

**Observed:** hour ending 05:59Z.

| Station | Distance | Hour mean | 1-min mean range | Direction s.d. |
|---|---|---|---|---|
| Plymouth Mountbatten | 38.8 km | 12.5 from 260° | 10.2–15.8 | 4° |
| Exeter Airport | 45.1 km | 7.0 from 250° | 5.0–9.5 | 7° |

**Units caveat:** the observation feed's speed units are **not yet confirmed** from Met Office documentation. Across 120 UK stations at 05:30Z, the median ratio of observed value to UKV wind in m/s was **1.84**. That strongly suggests **knots** (1 m/s = 1.94 kn). Until the documentation is checked, the values are labelled "knots (inferred)".

Full output: `research/weather/output/live_conditions_example.json` (about 10 KB, including a 10 × 10-cell wind grid over the Dart area).

## 3. Proposed integration

```
GitHub Actions cron (every 15–30 min)              Browser (simulator)
  live_conditions.py  ──►  live/latest.json  ──►   WeatherSource "Live (Met Office)"
  (Met Office S3, no keys)   (~10 KB, static)         ├─ base wind field: UKV grid, bilinear in space,
                                                      │   linear in time between 15-min steps
                                                      ├─ gust model: UKV gust/mean ratio
                                                      ├─ shift model: 1-min direction s.d. from obs
                                                      └─ fallbacks: cached → manual scenario
```

- **`WeatherSource` interface** in `sim/env`. Implementations:
  - `Manual` (the scenario sliders);
  - `LiveMetOffice` (the JSON above);
  - optional `OpenMeteo` (browser-direct);
  - optional `LocalStation`;
  - `Replay` (a recorded snapshot, so live sessions can be reproduced).
- **Determinism stays intact:** a live session captures the snapshot it started with, plus the seed, so it can be replayed exactly.
- **UI:**
  - A "Conditions" panel shows the source, kind (model or measured), valid time, age, distance of the observing station, and attribution.
  - A stale-data warning appears above a threshold.
  - A one-click "use live conditions" option in scenario setup.
- **Not covered by these data:** valley funnelling and wind shadows under the Dartmouth and Kingswear hills. A 2 km model can't resolve them. The optional terrain-influence layer stays labelled as an estimate.
- **Later (Phase 6):** visual weather (cloud cover, visibility, rain) from the same feeds.

## 4. Where it fits in the plan

| Phase | Live-weather work |
|---|---|
| 2 | **Done.** Manual and Met Office sources (`env/weather.ts`, `env/conditions.ts`). The UKV grid is interpolated spatially (brought forward from Phase 3). Gust and shift statistics come from the RDYC model point and the nearest station. The app discovers `live/latest.json` and offers a bundled, dated replay |
| 3 | Terrain sheltering or funnelling, if a defensible method exists; forecast-step interpolation |
| 6 | Production ingest job, caching, stale-data handling, visual weather |

If you want it sooner, a "live point mode" could also go into Phase 1 as a scenario preset.

## 5. Costs

- **Met Office open data:** free.
- **GitHub Actions:** free on a public repo. A private repo on GitHub Free gets 2,000 minutes a month, which fits a 30-minute schedule (about 1,440 runs). A 15-minute schedule would exceed it.
- **Open-Meteo:** free for non-commercial use; commercial use needs a paid plan.
- **DataHub:** the free tier allows 360 calls a day; paid tiers start at £8 a month.
