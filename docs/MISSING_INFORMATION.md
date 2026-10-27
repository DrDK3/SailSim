# Missing information and requests

Ordered by what it blocks. Uploads can go into this conversation or into `reference/` in the repo once it is pushed.

## A. Blocks verified RDYC courses (Phase 4)

| # | Needed | Why | Who or where |
|---|---|---|---|
| A1 | **RDYC Sailing Programme 2026** (PDF), including course plans | Official course definitions, mark names and the new river "gate" | royaldart.co.uk → Club Events (source R1) |
| A2 | **Current RDYC Sailing Instructions** for club racing, plus amendments and Racing Noticeboard notices | Start and finish definitions, rounding sides, shortening, river safety restrictions | RDYC Racing Noticeboard |
| A3 | **Mark positions** (lat/lon, with datum) for every RDYC mark, saying which are club marks and which are DHNA navigation buoys, plus any seasonal laid marks | Geographic placement. Without these, "verified" is impossible | Club mark list, race officer GPS, or chart |
| A4 | Name of the **person who will check** each course implementation against the source | The brief requires a human sign-off before "verified" | You |
| A5 | Any course restrictions specific to Squibs or the river (no-go areas, ferry-crossing rules, moorings to keep clear of) | The course validator must enforce them | SIs / DHNA / race officer |

## B. Blocks a faithful boat model (Phases 1–2, refinements later)

| # | Needed | Why |
|---|---|---|
| B1 | **NSOA Class Rules 2025** (PDF) and the measurement form | Confirm the sail areas (16.5 vs 15.8 m²), mast datum, boom limit, sail measurements, keel and rudder dimensions, crew rules |
| B2 | Squib **lines plan or hull offsets**, or measured photos (profile, plan, sections) | Hull shape, wetted area, lateral area, centre of lateral resistance |
| B3 | Keel and rudder **profile drawings or measurements** | Lift-generating areas, aspect ratio, CLR |
| B4 | **Rig photos** of an RDYC Squib (mast step, spreaders, backstay or runners, shrouds, jib tack, sheeting, kicker, cunningham, outhaul) | Rig geometry and which controls to model |
| B5 | **Performance evidence**: GPS tracks of RDYC Squib races with the wind recorded, typical tacking angles, upwind and downwind speeds by wind strength, from sailors | The only route to calibrating and validating speeds |
| B6 | Typical **crew numbers and weights** at RDYC | Righting-moment model |
| B7 | Reference **video**: tacks, gybes, heel, cockpit (your own or links) | Visual and manoeuvre plausibility |

## C. Environment data

| # | Needed | Why |
|---|---|---|
| C1 | **Network allowlist** for: `overpass-api.de` (OSM seamarks and buoys), `environment.data.gov.uk` (EA aerial imagery, LIDAR), `royaldart.co.uk`, `squibs.co.uk`, `dartharbour.org`, `en.wikipedia.org`, `admiralty.co.uk`. Set this in the cloud environment's settings, under Network access | I can then read primary documents myself instead of relying on search excerpts |
| C2 | A **legally usable bathymetry source**. Options: UKHO INSPIRE / Admiralty Marine Data Portal surveys (OGL), or a licence if you want chart-derived depths | Grounding and depth-dependent current. Admiralty chart data **cannot** go into a public app without a licence |
| C3 | **Real tides** (see `LIVE_TIDES.md`): allowlist `environment.data.gov.uk` and `admiraltyapi.azure-api.net`; obtain a free UKHO Discovery API key (kept server-side only); choose official UKHO, EA-derived, or both for predictions | Live measured tide height, official HW/LW, river-flow term |
| C8 | **Confirm the Dartmouth chart datum** (2.62 m below ODN?) from the Admiralty Tide Tables or Reeds | Converting the EA gauge (mAOD) to depths over chart datum |
| C4 | **Local knowledge of the stream**: where it runs hardest, eddies (e.g. off Kingswear or the castles), slack-water timing relative to HW, wind-against-tide spots | To shape the provisional current model honestly |
| C5 | **Local wind knowledge**: typical sea-breeze direction, valley funnelling, wind shadows under the Kingswear and Dartmouth hills | Spatially varying wind model |
| C6 | Does **RDYC or DHNA run a weather station** (anemometer) with an accessible feed? Vendor and API? | The only route to truly real-time, measured, *local* wind |
| C7 | Allowlist `api.open-meteo.com` if you want the browser-direct option tested | Optional live source |

## D. Project decisions (please confirm)

| # | Decision | My recommendation |
|---|---|---|
| D1 | Technology stack | TypeScript + Vite + Three.js (3D) + React (DOM UI only) + Vitest + Playwright. Custom sailing physics with no third-party physics engine. See `ARCHITECTURE.md` |
| D2 | Spinnaker | Squibs race with a symmetric spinnaker. Model main and jib first, then add the spinnaker after the course system works (end of Phase 4 or Phase 5) |
| D3 | Source control | This repo is **local to an ephemeral cloud container**. Connect GitHub (https://claude.ai/connect-github) and create an empty repo, so I can attach it and push after every phase |
| D4 | Hosting | Static hosting (GitHub Pages or Cloudflare Pages). No recurring cost unless you want a custom domain or a tidal-API proxy |
| D5 | Live-weather source | Met Office open data via a scheduled ingest (free, no keys, tested). Add a local station if one exists. Open-Meteo only as a non-commercial fallback |

## E. For the hi-fi models (25 Oct 2026)

| # | Needed | Why |
|---|---|---|
| E1 | **Allow `environment.data.gov.uk`** in the environment's network settings | The Environment Agency LIDAR surface model (DSM, 1 m, Open Government Licence) gives every building's measured height and roof shape; it is the only route to "accurate" roofs |
| E2 | A **photo of an RDYC Squib's transom** and of the **burgee** (or the club's artwork) | To match the lettering style and the crown and dart; both are drawn from the blazon and an estimate now |
| E3 | **Weights** of a Rondar and an older Hunter or Parker Squib as weighed at events, and how a classic cockpit is bailed (bucket, pump) | The classic type's extra weight and bailing rate are estimates |
| E4 | Any **comparison of the Hyde B3 / Batt sails with older sails** (pointing angle, speed, from tuning partners or GPS) | The new sails' effects are the maker's claims; their size is estimated |
| E5 | **Lower and Higher Ferry** details: float and tug lengths and beams, crossing and loading times, the hours of the second Lower Ferry unit, the Higher Ferry's current status; **photographs** of the floats, the Hauley tugs, the Higher Ferry and the passenger boats (liveries) | The vessels' sizes, shapes and colours and their timing are estimates, except the Dartmouth Princess's length and blue hull and the Cardiff Castle's size (F7, F8) |
| E6 | **Dart Marina movements**: typical departures and arrivals per day by season | The marina traffic is an estimate |
| E7 | **Berth plans** of Darthaven, Dart Marina and Noss on Dart Marina (finger lengths, berth widths, which pontoons take which sizes), and **occupancy** by season; movements per day for each | Berths are laid out on OSM's pontoons by rule (finger berths about a beam apart, both sides); occupancy and movements are estimates (F12, F13 are the only checks) |
| E8 | **Dartmouth Steam Railway**: the 2026 operating calendar and timetables by date (F9 is one day's), the usual train formation (coaches, which engine), how the engine runs round at Kingswear (which crossovers, how long), and the train shed's and canopy's lengths | The trains run F9's four-train timetable every day of the season; the run-round moves, formation and shed extents are estimates |
| E9 | **Lower Ferry slips**: the slips' levels and where the float lies at high and low water; which side of the float each tug works | The berth comes from the provisional bathymetry and estimated drafts; the tug's side is chosen to keep it afloat |
| E10 | **Squib heavy-weather data**: speeds and heel close-hauled and reaching in 20–30 kn (GPS tracks from RDYC Squibs), how crews depower (backstay or not, kicker, cunningham, outhaul, traveller or bridle), at what wind they flatten, and when racing stops | The auto main's heel limit (24°), the flatten control's effects (lift −30%, drag −20%, centre of effort −10%) and the AI's flattening from 12 to 20 kn are estimates; downwind speeds in 30 kn gusts look high (issue 37) |
| E11 | **Photographs and dimensions of the landmarks**: BRNC's central tower (height, cupola) and pavilion towers; Dartmouth Castle; St Petrox's tower; Kingswear Castle's turret; the RDYC clubhouse and flagstaff; the Royal Dart Hotel's balcony; Dart Marina Hotel; the Noss on Dart buildings. Allowing `commons.wikimedia.org`, `upload.wikimedia.org`, `geograph.org.uk` and `historicengland.org.uk` would let them be read | The landmarks follow listing descriptions; their proportions are estimates |
| E12 | **Dartmouth's tidal levels** (MHWS, MHWN, MLWN, MLWS) from the UKHO tables | Random races use high water 4.6 m and low water 1.2 m above chart datum at any phase, as the app's other scenarios (E) |
| E13 | **Coaching rules of thumb** from Squib coaches: heel targets, when to tack on a shift in the Dart, what counts as a good start | The coach's thresholds (30° overpowered, 8° header, 35% tack loss) are estimates |
