# Live and replay data served with the app

| File | What it is |
|---|---|
| `metoffice-replay-2026-10-22T0715Z.json` | A Met Office UKV + land-observation snapshot taken on 22 Oct 2026 (valid 07:15 UTC), produced by `research/weather/live_conditions.py`. Offered in the app as a **replay**, clearly labelled with its valid time and age. British Crown copyright, the Met Office, CC BY-SA 4.0. |
| `latest.json` (absent) | Written by the scheduled ingest job (Phase 6). When present, the app offers it as **Live Met Office**. |
| `tide.json` (absent) | Written by the planned tide ingest (docs/LIVE_TIDES.md). When present, the app offers it as **Live tide**. |
