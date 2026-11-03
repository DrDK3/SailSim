# Source register

This register belongs to [COMPREHENSIVE_REVIEW.md](../COMPREHENSIVE_REVIEW.md) §6 and §7. For each dataset it records the source, date, resolution, coverage, licence and uncertainty. Full citations are in [SOURCES.md](../SOURCES.md) and the dataset IDs (G1, W1, T1 …) refer to it.

**Status:**

- **In use:** the app or the pipeline uses it today.
- **Candidate:** proposed, not used.
- **Blocked:** wanted, but not obtained.

## Geography

| ID | Dataset | Date | Resolution | Coverage | Licence | Uncertainty | Status |
|---|---|---|---|---|---|---|---|
| G1 | Overture Maps (OSM coastline, riverbanks, piers, places, roads) | Release 2026-10-21.0 | Vector | Global; clipped to e −3200…+3600 m, n −5200…+4560 m about RDYC | ODbL 1.0 (OSM-derived) | Crowd-sourced; outline positions to a few metres | In use |
| G2 | EA LIDAR Composite DTM 2 m via Tilezen terrarium tiles (z15) | Survey date unknown | About 3 m (tiles), sampled to 8 m (4 m in the towns) | The domain | OGL v3 (EA); Tilezen attribution | Vertical about 0.15 m typical for LIDAR (L3); the water surface is at survey time | In use |
| G5 | Sentinel-2 L2A true colour, scene S2C_30UVA_20250712 | 12 Jul 2025 | 10 m | The domain | Copernicus (free, attribution) | Visual only | In use |
| G6 | Microsoft ML building footprints and heights (via Overture) | 2026-10-21.0 | Vector | The towns | ODbL 1.0 | Heights: machine-learned estimates | In use |
| — | Bed below the low-water line | — | 8 m grid | Harbour and Start Bay | — | **Estimated (L6)**: exponential profile | In use (estimate) |
| G4 | Copernicus DEM GLO-30 | — | 30 m | Land | Copernicus DEM licence | Backup only | Candidate |
| H10 | UKHO Admiralty chart 2253 (Dartmouth Harbour): bathymetry and tidal diamonds | Current edition | Chart scale | Harbour | **Copyright; licence needed** | Authoritative for navigation | Blocked (licence) |
| — | UKHO survey bathymetry (ADMIRALTY marine data portal) | Varies | Survey | Partial coverage (to check) | Some datasets under OGL (to confirm) | Survey-grade where covered | Candidate |
| — | DHNA (Dart Harbour) hydrographic surveys | Unknown | Survey | Harbour | Unknown: ask | Survey-grade | Candidate (ask, D6) |
| — | Mooring layout | — | — | — | — | Generated today (L6) | Candidate (ask DHNA) |
| — | RDYC 2026 programme, SIs, course cards, mark positions | 2026 | — | — | Club documents | Authoritative for club racing | **Blocked** (`royaldart.co.uk`; needed from you) |

## Weather

| ID | Source | Kind | Resolution and cadence | Coverage | Licence and cost | Uncertainty | Status |
|---|---|---|---|---|---|---|---|
| W1 | Met Office UKV 2 km on AWS open data | Forecast | 2 km; 15-min steps; this project uses 8 h | UK | CC BY-SA 4.0; free | Cannot resolve the Dart valley; gusts heuristic | In use |
| W2 | Met Office UK land observations on AWS (Plymouth Mountbatten, Exeter Airport) | Observation | 1-min, hourly batches; rolling 7 days | Stations 35–45 km away | CC BY-SA 4.0; free | Regional only; used for the shift size; speed units inferred as knots (to confirm) | In use (shift size only) |
| — | Met Office DataHub site-specific API | Forecast | Point; hourly or better | Any point | Met Office terms; free tier 360 calls a day; paid from £8 a month | As for the UKV | Candidate (needs a server-side key) |
| W3 | Open-Meteo (UKMO models) | Forecast and "current" | Point; 15 min | Any point | CC BY 4.0; free for non-commercial use only | As for the UKV | Candidate (licence fit to confirm) |
| — | A harbour or club anemometer | Observation | — | The Dart | Unknown | Would be the only local measurement | Candidate (ask, validation sheet C7.2) |

## Tide and streams

| ID | Source | Kind | Resolution and cadence | Coverage | Licence and cost | Uncertainty | Status |
|---|---|---|---|---|---|---|---|
| T1 | EA flood-monitoring API, station 46154 "Dartmouth" | Observation (tidal level, mAOD) | 15 min | Dartmouth | OGL v3; free | Gauge-grade; attribution required | In use |
| — | Harmonic prediction from the EA gauge history (utide) | Prediction | Any time | Dartmouth | Derived from OGL data | Validated in LIVE_TIDES.md | In use |
| T3 | UKHO ADMIRALTY UK Tidal API, Discovery tier | Prediction (HW/LW) | Events; 7 days | 607 UK stations | Free for one year; UKHO terms (display and caching to confirm) | Authoritative predictions | In use (key server-side only) |
| T4 | UKHO Tidal API Foundation / Premium | Prediction | 13 days / 1 year ahead | As above | £120 / £300 a year | As above | Candidate |
| T5 | EA station 3216, River Dart at Austins Bridge | Observation (river level) | 15 min | Upstream | OGL v3 | Flow inferred | Candidate (river flow on the ebb) |
| T7 | Copernicus Marine North-West Shelf model | Forecast (sea level, currents) | 1.5 km; hourly | Start Bay offshore only | Free (registration) | Too coarse for the river | Candidate (Start Bay) |
| — | **Tidal stream timing and rates** for the harbour and Start Bay (tidal diamonds; stream atlases) | Published tables | By hour from HW at a reference port | Diamond positions | UKHO licence needed; cost to confirm | Authoritative | **Blocked** (licence; D5) |
| — | Stream pattern used today | Model | 16 m grid | Harbour | — | **Estimated (L6)**; timing slaved to dh/dt (EN-1) | In use (to be replaced) |

## Squib class

| Source | What | Status |
|---|---|---|
| NSOA class rules 2022 / 2024 (excerpts) | Minimum weight, mast, spinnaker pole and hoist, sails carried | Partial |
| NSOA class rules 2025 | Full rules, including the permitted controls | **Needed** (D9) |
| keelindex, Wikipedia | Dimensions, ballast, ORC GPH, PY | In use (secondary) |
| GPS tracks with wind | Measured performance | **Needed** (validation sheet A5) |

## Blocked hosts in this environment

These hosts could not be reached under the environment's network policy:

- `royaldart.co.uk`, `en.wikipedia.org`, `simplonpc.co.uk`, `dartmouthrailriver.co.uk`;
- the CI log host `results-receiver.actions.githubusercontent.com` and the CI artifact host `productionresultssa14.blob.core.windows.net`;
- broker and review sites (403 or DNS failure): `devalk.nl`, `boats.com`, `sailboat-cruising.com`, boatshed, `practical-sailor.com`, `sailmagazine.com`;
- `cdnjs.cloudflare.com`.
