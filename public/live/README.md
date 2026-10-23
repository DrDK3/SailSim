# Live and replay data served with the app

The app reads `index.json` first and fetches only the files it lists (docs/DEPLOYMENT.md).

| File | What it is |
|---|---|
| `index.json` | The list of data files (schema `squib-live-index/1`). The scheduled jobs rewrite it on the published site. |
| `metoffice-replay-2026-10-23T1400Z.json` | A Met Office UKV forecast written by `tools/ingest/weather.py` on 23 Oct 2026 (run 10:00 UTC; wind every 15 min from 14:00 to 16:00 UTC; hourly cloud, visibility and rain). Schema `squib-weather/2`. Offered as a **replay**. British Crown copyright, the Met Office, CC BY-SA 4.0. |
| `metoffice-replay-2026-10-22T0715Z.json` | A Met Office UKV + land-observation snapshot of 22 Oct 2026 (valid 07:15 UTC), from `research/weather/live_conditions.py`. Schema `squib-weather/1` (one forecast time). Offered as a **replay**. British Crown copyright, the Met Office, CC BY-SA 4.0. |
| `latest.json` | *Published site only.* The live forecast, every 30 minutes (`.github/workflows/live-data.yml`). |
| `tide.json` | *Published site only.* Dartmouth tide: EA gauge readings and HW/LW predictions. |
| `tide-predicted.json`, `tide-harmonics.json` | *Published site only.* A year of HW/LW events from harmonic constants derived from the EA gauge, and the constants with their validation (weekly). |
