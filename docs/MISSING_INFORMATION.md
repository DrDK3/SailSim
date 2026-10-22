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
| C3 | Choice of **tidal height source**: manual HW time and height entry (free, no keys), or the Admiralty UK Tidal API (needs a key and a small server proxy) | Tide-height scenarios |
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
