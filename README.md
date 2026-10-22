# Squib Sailing Simulator: Royal Dart / Dartmouth

A browser-based 3D sailing simulator for the National Squib one-design keelboat on the River Dart, based at the Royal Dart Yacht Club, Kingswear. It aims for:

- geographically grounded scenery;
- a sailing physics model that can be calibrated;
- authentic local courses, verified against official club documents.

## Status

**Phase 0: research and feasibility. Awaiting plan approval.** No simulator code exists yet.

| Document | Contents |
|---|---|
| [docs/RESEARCH_REPORT.md](docs/RESEARCH_REPORT.md) | Findings with confidence tags (V / S(p) / S / E / N) |
| [docs/SOURCES.md](docs/SOURCES.md) | Source register: URLs, dates, how each was accessed |
| [docs/MISSING_INFORMATION.md](docs/MISSING_INFORMATION.md) | Documents, data and decisions needed |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Proposed technical architecture and trade-offs |
| [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md) | Phases 1–6, acceptance criteria, first milestone |
| [docs/LIVE_WEATHER.md](docs/LIVE_WEATHER.md) | Real-time weather: sources tested, snapshot, proposed integration |
| [docs/OUTSTANDING_ISSUES.md](docs/OUTSTANDING_ISSUES.md) | Open issues and known risks |

## Reproducing the geodata feasibility spike

Requires Python 3.11+ and outbound access to AWS S3.

```bash
python3 -m venv .venv && .venv/bin/pip install -r research/geodata/requirements.txt
.venv/bin/python -I research/geodata/extract_overture.py /tmp/dart-extract          # ~1 min
.venv/bin/python -I research/geodata/feasibility_report.py /tmp/dart-extract research/geodata/output
.venv/bin/python -I research/geodata/probe_terrain.py
```

Outputs:

- `research/geodata/output/landmarks_extracted.json`
- `research/geodata/output/feasibility_map_osm.png`
- printed water widths and terrain spot heights

## Reproducing the live-weather spike

```bash
.venv/bin/pip install -r research/weather/requirements.txt
.venv/bin/python -I research/weather/live_conditions.py /tmp/live.json   # ~10 s; Met Office open data on AWS
```

## Data attribution

| Data | Attribution and licence |
|---|---|
| Map data | © OpenStreetMap contributors, ODbL 1.0, via Overture Maps Foundation |
| Weather | British Crown copyright, the Met Office, CC BY-SA 4.0 (UKV model and land observations, via AWS Open Data) |
| Terrain | © Environment Agency copyright and/or database right 2015. All rights reserved. Open Government Licence v3, via Tilezen terrain tiles |

The feasibility map is **not for navigation**.
