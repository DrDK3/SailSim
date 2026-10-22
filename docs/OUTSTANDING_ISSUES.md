# Outstanding issues and risks

Updated: 22 Oct 2026 (end of Phase 0)

| # | Issue | Impact | Next step |
|---|---|---|---|
| 1 | No RDYC course documents have been inspected first-hand | No verified club courses are possible yet | Request A1–A3 |
| 2 | Class-rule figures come only from search excerpts; there is a sail-area conflict (16.5 vs 15.8 m²) | Boat parameters are uncertain by a few percent | Request B1 |
| 3 | No Squib hull lines, rig drawings or performance data | Hydrodynamic and aerodynamic coefficients are estimates; speeds cannot be validated | Request B2–B5; design the calibration workflow (Phase 2) |
| 4 | No legally usable bathymetry in the river | Depth and grounding will be provisional | Request C2 |
| 5 | No measured current data inside the harbour; secondary sources conflict on peak rates (2–3.5 kn vs about 4 kn) | The current field is a labelled scenario model | Request C4; ask DHNA |
| 6 | Navigation-buoy positions: only Castle Ledge has a (secondary) position | Approach marks are incomplete | Allowlist `overpass-api.de` for OSM seamarks as a cross-check; the official list of lights or DHNA list is preferred |
| 7 | Network policy blocks the key primary sites | Research had to rely on excerpts | Request C1 |
| 8 | The repo exists only in an ephemeral container | Work is lost if the container is reclaimed | Connect GitHub and create a remote (D3) |
| 9 | OSM accuracy is unverified (shoreline, pontoons, ferry lines are schematic) | Possible local position errors of several metres | Spot-check against EA aerial imagery once it is accessible |
| 10 | The terrain DEM has a flattened water surface, and some entrance tiles blend in lower-resolution DEMs | The waterline needs the OSM shoreline as authority; cliffs near the castles may be smoothed | Handle in the Phase 3 pipeline |
| 11 | Met Office observation wind units not documented here (inferred knots from a 120-station comparison with UKV) | Live observed wind could be mis-scaled | Confirm from the Met Office ASDI documentation (host blocked) |
| 12 | No public anemometer on the Dart; nearest measured stations are 39–45 km away; the UKV run is 3–6 h old when published | "Live" wind is regional, or a short-range forecast, not a local measurement | Ask for an RDYC/DHNA station feed (C6); label the source and age in the UI |
