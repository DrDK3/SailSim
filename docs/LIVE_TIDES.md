# Real tidal conditions: findings and proposed design

- **Added:** 22 Oct 2026, at the user's request.
- **Status:** sources identified. **No tide data could be fetched from this environment**, because every tide host is blocked by the network policy. Nothing below has been tested against live data yet.

## 1. Three different things, kept separate

| Quantity | What "real" can mean | Best source found | Covers the Dart? |
|---|---|---|---|
| **Tide height, measured now** | Actual water level, including surge and river effects | **EA tide gauge "Dartmouth"** (15-min) | **Yes**, at the Town Jetty |
| **Tide height, predicted** (HW/LW times and heights, any date) | Official astronomical prediction | **UKHO Admiralty UK Tidal API** | Yes (Dartmouth is a UKHO secondary port) |
| **Tidal stream** (current speed and direction) | Measured current | **None exists publicly** for the harbour (see `RESEARCH_REPORT.md` §4) | No |

The stream will therefore be **driven by real tidal timing and strength**: hours relative to HW, spring/neap range and river flow. Its spatial pattern and peak rates will be a **provisional model**, labelled as such.

## 2. Sources

| # | Source | Details | Latency | Access | Licence | Tag |
|---|---|---|---|---|---|---|
| T1 | **EA real-time flood-monitoring API, station 46154 "Dartmouth"** | Measure `46154-level-tidal_level-i-15_min-mAOD`. Position about 50.3512 N, 3.5772 W (OS SX 878 513). WISKI ID SX85F010. Record high 2.98 mAOD (date conflicts between sources) | 15 min; typically 15–30 min behind | `environment.data.gov.uk/flood-monitoring/…`, no key | OGL v3, with the EA's required attribution | S (third-party listings, riverlevels.uk and floodradar). **Verify against the API once reachable** |
| T2 | EA flood-monitoring daily archive | Full historical 15-min readings (to derive harmonic constants) | n/a | Same host | OGL v3 | N (existence to confirm) |
| T3 | **UKHO Admiralty UK Tidal API, Discovery tier** | HW/LW times and heights, today plus 6 days, for 607 UK stations | Predictions | API key (free, 1-year subscription), so **server-side only** | UKHO terms. **Public-display terms not yet confirmed** | S |
| T4 | UKHO Tidal API Foundation / Premium | Foundation £120/yr (13 days ahead); Premium £300/yr (historical, and 1 year ahead) | Predictions | Key | UKHO terms | S |
| T5 | **EA station 3216, River Dart at Austins Bridge** (Buckfastleigh) | River level, 15-min; flow may be available via the EA Hydrology API. Long-term mean flow about 11.0 m³/s (Wikipedia) | 15 min | EA API, no key | OGL v3 | S |
| T6 | Chart datum at Dartmouth | **2.62 m below ODN** (from a marina page reproducing NOC-computed Dartmouth predictions). Devonport is 3.22 m (NTSLF) | — | — | — | S. **Confirm from the Admiralty Tide Tables or Reeds** |
| T7 | Copernicus Marine NW Shelf model (1.5 km) | Hourly sea level and currents including tides; covers **Start Bay offshore only** (too coarse for the river) | Forecast | Free account, so server-side credentials | Copernicus Marine licence | S (optional) |
| T8 | Open-Meteo Marine API | Model sea level and currents, global and coarse | Forecast | No key | CC BY 4.0, non-commercial | S (low value) |

**Conversion used by the simulator:**

```
height above chart datum (m) = EA level (mAOD) + 2.62
```

The 2.62 is provisional (T6). For example, a reading of −0.86 mAOD would be about 1.76 m above chart datum.

## 3. Proposed integration (extends the live-weather ingest in `LIVE_WEATHER.md`)

```
Scheduled ingest (GitHub Actions, every 15–30 min)              Browser
  ├─ EA 46154 Dartmouth: latest + last 48 h of levels  ─┐
  ├─ EA 3216 Austins Bridge: river level (+ flow)       ├─► live/tide.json ─► TideSource "Live"
  └─ UKHO API (key held as a CI secret): HW/LW 7 days  ─┘     (~5 KB)          ├─ height now = measured
                                                                               ├─ curve ahead = UKHO events
                                                                               │   + measured offset (surge)
                                                                               ├─ phase = time from HW Dartmouth
                                                                               ├─ spring/neap = range / mean range
                                                                               └─ river bias = Austins Bridge flow
```

- **Tide height:**
  - In live mode: the measured Dartmouth level, then a forward curve from the UKHO HW/LW events, shifted by the current measured-minus-predicted residual.
  - In scenarios for other dates: either UKHO predictions (needs the paid tier beyond 7 days), or **our own harmonic prediction** derived from the EA gauge history (OGL) using a standard harmonic analysis (e.g. UTide). That second option is labelled *"derived from EA observations; not an official UKHO prediction"*, with its validation error (RMS against observations) shown.
- **Tidal stream (provisional model, phase and strength from real data):** C(x, y, t) = f(x, y) · s(phase, range) + river term.
  - f(x, y): the channel-following pattern (Phase 3).
  - s: scaled so a mean-spring flood or ebb at the entrance peaks at the configured rate (default ≈ 2 kn per DHNA).
  - River term: grows with Austins Bridge flow, reflecting the DHNA statement that the ebb runs harder after heavy rain (up to about 3.5 kn).
  - All coefficients are tagged **E** and calibratable. The UI labels the stream *"modelled from real tide timing; not measured"*.
- **Depth:** provisional bathymetry (relative to chart datum) plus the live height above chart datum. Grounding uses that.
- **UI conditions panel:**
  - height above chart datum and in mAOD;
  - rising or falling;
  - time to the next HW and LW;
  - springs or neaps;
  - measured-minus-predicted residual;
  - stream set and rate (labelled model);
  - data age and source;
  - attribution.
- **Fallbacks and determinism:** as for weather. The cached snapshot is used first, then manual input. Each live session records its tide snapshot so it can be replayed.

## 4. Where it fits in the plan

| Phase | Tide work |
|---|---|
| 2 | **Done.** `TideSource` (manual, and the snapshot format the live ingest will write, with gauge residual) and a provisional **uniform** tidal stream driven by the tide timing. Live fetching is not yet tested (hosts blocked here) |
| 3 | Spatial current pattern f(x, y); depth relative to chart datum; grounding at the live height; river-flow term |
| 6 | Production ingest (EA plus UKHO), harmonic-constant derivation and validation, stale-data handling |

## 5. What I need to build and test this

1. **Allow these hosts** in the environment's network settings:
   - `environment.data.gov.uk` (EA gauges and archive);
   - `admiraltyapi.azure-api.net` (UKHO Tidal API).
   - Optional: `marine-api.open-meteo.com`.
2. **A UKHO Discovery API key** (free; sign-up at the ADMIRALTY developer portal). It will be stored only as a server-side CI secret, **never in the app**.
3. **Your preference** for prediction source: official UKHO, derived from EA observations, or both (my recommendation: both, with UKHO as authority where available).
4. **Confirm the Dartmouth chart-datum offset** (2.62 m below ODN) from your tide tables.
