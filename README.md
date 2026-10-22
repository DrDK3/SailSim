# Squib Sailing Simulator: Royal Dart / Dartmouth

A browser-based 3D sailing simulator for the National Squib one-design keelboat on the River Dart, based at the Royal Dart Yacht Club, Kingswear. It aims for:

- a sailing physics model that can be calibrated;
- geographically grounded scenery;
- authentic local courses, verified against official club documents.

## Status

| Phase | State |
|---|---|
| 0: research and feasibility | Done ([research report](docs/RESEARCH_REPORT.md)) |
| **1: a working boat in simple water** | **Done, 22 Oct 2026** ([phase report](docs/PHASE1_REPORT.md)) |
| 2: tested physics (dynamic roll, boom dynamics, gusts, current, live wind) | Next |
| 3: River Dart environment · 4: courses · 5: racing and AI · 6: polish and deployment | Planned ([plan](docs/DEVELOPMENT_PLAN.md)) |

Physics coefficients are **estimates** awaiting Squib performance data. This is not for navigation or performance prediction.

![Phase 1: close-hauled on starboard](docs/img/phase1-chase-closehauled.png)

## Quick start

Requires Node.js 22+.

```bash
npm install          # .npmrc sets legacy-peer-deps (works around an npm peer-resolution bug)
npm run dev          # open the printed URL; press H in the app for help
```

| Command | What it does |
|---|---|
| `npm run dev` | Development server with hot reload |
| `npm run build` | Typecheck everything, then build static files to `dist/` |
| `npm run preview` | Serve the production build on http://localhost:4173 |
| `npm test` | Physics unit and acceptance tests (Vitest, about 30 s) |
| `npm run test:e2e` | Build, serve and run the browser tests (Playwright). Uses `/opt/pw-browsers/chromium` or `$PW_CHROMIUM` |
| `npm run typecheck` / `npm run lint` | TypeScript (app, DOM-free sim, tests) and ESLint |
| `npm run scenario -- scenarios/beat-10kn.json` | Run a scenario headlessly and write a CSV trace to `out/` |
| `npm run polar` | Model-output speed table (not validated data) |
| `npm run params` | Regenerate [docs/PARAMETERS.md](docs/PARAMETERS.md) from the boat data |

## Controls

| Key | Action |
|---|---|
| A / ← and D / → | Steer to port / starboard (hold; the helm self-centres; hold Shift to keep it) |
| W / ↑ and S / ↓ | Trim / ease the mainsheet |
| E / Q | Trim / ease the jib sheet |
| M / J | Auto-trim assist for main / jib |
| K | Auto crew weight |
| X | Release both sheets (stop) |
| Space | Centre the helm |
| P / R | Pause / reset |
| C | Cycle camera |
| F / G | Force arrows / physics panel |
| H | Help |

On-screen buttons provide the same controls.

## Project layout

```
src/sim/      physics core: pure TypeScript, no DOM/Three/React (lint and tsconfig enforced)
src/render/   Three.js scene, water, procedural Squib, wake, force arrows
src/ui/       React instruments, controls, debug, scenario and help panels
src/app/      game loop (fixed 100 Hz step with render interpolation), input handling
data/boats/   class data and calibration coefficients, each with source and confidence tag
scenarios/    repeatable headless scenarios (JSON)
tests/        Vitest (sim) and Playwright (browser) suites
tools/        scenario runner, polar and parameter-table generators
research/     Phase 0 geodata and live-weather feasibility scripts (Python)
docs/         research, sources, architecture, plan, physics, parameters, reports
```

## Documentation

| Document | Contents |
|---|---|
| [docs/PHASE1_REPORT.md](docs/PHASE1_REPORT.md) | What works, test results, revised criteria, known defects, manual test steps |
| [docs/PHYSICS.md](docs/PHYSICS.md) | Every force model, its equations and conventions, plus model outputs |
| [docs/PARAMETERS.md](docs/PARAMETERS.md) | Generated table of every boat parameter with value, unit, tag and source |
| [docs/RESEARCH_REPORT.md](docs/RESEARCH_REPORT.md) | Phase 0 findings with confidence tags |
| [docs/SOURCES.md](docs/SOURCES.md) | Source register |
| [docs/MISSING_INFORMATION.md](docs/MISSING_INFORMATION.md) | Documents, data and decisions still needed |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Architecture and trade-offs |
| [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md) | Phases and acceptance criteria |
| [docs/LIVE_WEATHER.md](docs/LIVE_WEATHER.md), [docs/LIVE_TIDES.md](docs/LIVE_TIDES.md) | Real-time wind and tide: sources and design |
| [docs/OUTSTANDING_ISSUES.md](docs/OUTSTANDING_ISSUES.md) | Open issues and risks |

## Research spikes (Python)

```bash
python3 -m venv .venv && .venv/bin/pip install -r research/geodata/requirements.txt -r research/weather/requirements.txt
.venv/bin/python -I research/geodata/extract_overture.py /tmp/dart-extract
.venv/bin/python -I research/geodata/feasibility_report.py /tmp/dart-extract research/geodata/output
.venv/bin/python -I research/geodata/probe_terrain.py
.venv/bin/python -I research/weather/live_conditions.py /tmp/live.json
```

## Data attribution

| Data | Attribution and licence |
|---|---|
| Map data (research) | © OpenStreetMap contributors, ODbL 1.0, via Overture Maps Foundation |
| Weather (research) | British Crown copyright, the Met Office, CC BY-SA 4.0 (UKV model and land observations, via AWS Open Data) |
| Tide gauges (planned) | Contains Environment Agency data, Open Government Licence v3; UKHO predictions © Crown copyright (terms to confirm) |
| Terrain (research) | © Environment Agency copyright and/or database right 2015. All rights reserved. Open Government Licence v3, via Tilezen terrain tiles |
