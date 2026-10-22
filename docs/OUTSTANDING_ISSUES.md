# Outstanding issues and risks

Updated: 22 Oct 2026 (end of Phase 4)

| # | Issue | Impact | Next step |
|---|---|---|---|
| 1 | No RDYC course documents have been inspected first-hand | No club courses are possible yet (the format, validator and verification workflow are ready) | Request A1–A3, then enter courses as described in COURSES.md |
| 2 | Class-rule figures come only from search excerpts; there is a sail-area conflict (16.5 vs 15.8 m²) | Boat parameters are uncertain by a few percent | Request B1 |
| 3 | No Squib hull lines, rig drawings or performance data | Hydrodynamic and aerodynamic coefficients are estimates; speeds cannot be validated | Request B2–B5. The calibration workflow is ready ([CALIBRATION.md](CALIBRATION.md)); it needs observations |
| 4 | No legally usable bathymetry in the river | Mid-channel depths and groundings there are provisional (LIDAR covers the drying areas near the shore) | Request C2 (UKHO INSPIRE survey data or a DHNA survey) |
| 5 | No measured current data inside the harbour; secondary sources conflict on peak rates (2–3.5 kn vs about 4 kn) | The current field is a labelled scenario model | Request C4; ask DHNA |
| 6 | Navigation-buoy positions: only Castle Ledge has a (secondary) position | Approach marks are incomplete | Allowlist `overpass-api.de` for OSM seamarks as a cross-check; the official list of lights or DHNA list is preferred |
| 7 | Network policy blocks the key primary sites | Research had to rely on excerpts | Request C1 |
| 8 | The repo exists only in an ephemeral container | Work is lost if the container is reclaimed | Connect GitHub and create a remote (D3) |
| 9 | OSM accuracy is unverified (shoreline, pontoons, ferry lines are schematic) | Possible local position errors of several metres. The visible shoreline comes from LIDAR, the pontoons from OSM | Spot-check against EA aerial imagery once it is accessible |
| 10 | ~~The terrain DEM has a flattened water surface, and some entrance tiles blend in lower-resolution DEMs~~ | **Handled in Phase 3:** the OSM water mask decides water; inside it, LIDAR above the survey water level is kept as drying areas; offshore blends are replaced by the provisional bed | — |
| 11 | Met Office observation wind units not documented here (inferred knots from a 120-station comparison with UKV) | Live observed wind could be mis-scaled | Confirm from the Met Office ASDI documentation (host blocked) |
| 12 | No public anemometer on the Dart; nearest measured stations are 39–45 km away; the UKV run is 3–6 h old when published | "Live" wind is regional, or a short-range forecast, not a local measurement | Ask for an RDYC/DHNA station feed (C6); label the source and age in the UI |
| 13 | Tide hosts (EA, UKHO, NTSLF) blocked here; EA Dartmouth station details are from third-party listings | Live tide not yet tested | Allowlist the hosts (C3), then build and test the ingest |
| 14 | Chart-datum offset at Dartmouth (2.62 m below ODN) is from a secondary source | Depth over chart datum could be offset | Confirm (C8) |
| 15 | UKHO licence terms for publicly displaying API predictions unconfirmed | May restrict a public deployment | Check the UKHO terms before Phase 6; EA-derived predictions are the fallback |
| 16 | Model pointing probably a few degrees optimistic (minimum heading-TWA 22° from rest, best VMG around 35–40°) | Upwind tactics slightly favour pinching | Calibrate against Squib tacking angles and GPS tracks (B5) |
| 17 | Cross-engine determinism is within tolerance (~1e-13), not bit-exact | Replays recorded in one browser may differ by about 1e-13 in another | Port a deterministic maths library (sin, cos, pow) if bit-exact cross-browser replays are needed |
| 18 | ~~Gybe uses a by-the-lee threshold; heel is quasi-static~~ | **Closed in Phase 2:** dynamic roll and a hinged main boom; gybes and crash gybes emerge | — |
| 19 | Residuary resistance is a parametric curve, not the Delft series | Speed near hull speed is estimated | Source DSYHS coefficients and Squib hull parameters |
| 20 | Single 902 kB JS bundle (the polar worker is split out) | Slower first load on mobile | Code-split in Phase 6 |
| 21 | Upwind heel at 15 kn is high (about 28° close-hauled with auto crew) | Heavy-air upwind behaviour and speed are uncertain | Depowering (traveller, kicker, twist) needs rig information (B4) and evidence (B5, B7) |
| 22 | Gust and shift statistics are estimates; the "from data" mapping (UKV gust ratio, a station 39 km away) is an unvalidated heuristic | Gustiness on the Dart may be badly wrong, especially near the steep valley sides | A local wind log (C6) would allow fitting the presets |
| 23 | The tidal stream is uniform in space; its flood direction (330°) and peak rates are estimates | Tidal tactics (cheating the tide inshore) cannot be represented yet | Phase 3 channel-following field; measured data (C4) to validate |
| 24 | The live weather ingest is not deployed; the app uses a dated replay, at a single forecast valid time | "Live" wind needs the scheduled job | Phase 6 ingest (free data; a small scheduled job) |
| 25 | The jib is kinematic, not a hinged body | Jib behaviour in a gybe is simplified | Acceptable for now; revisit if it looks wrong in manoeuvres |
| 26 | Moorings, pontoons and ferries are not obstacles | You can sail through moored boats, pontoons and ferries | Phase 5 (collisions, right of way, AI) |
| 27 | Individual mooring positions, ferry timetables and vessel sizes are estimates | Scenery and traffic are illustrative | Ask DHNA and the ferry operators; moorings from DHNA or aerial imagery |
| 28 | The LIDAR survey date and tide are unknown | The lower edge of the drying areas is approximate | Look up the EA survey metadata (host blocked) |
| 29 | The 8 m elevation grid turns quay walls into ramps | Boats ground a few metres off walls | Finer near-shore grid if it matters for racing |
| 30 | River Dart data is 5.1 MB uncompressed; main JS bundle 943 kB | Slower first load on mobile | Quantise and compress the grids, code-split (Phase 6) |
| 32 | The racing-rules behaviour follows secondary summaries; the 2025–2028 rulebook text was not inspected | Edge cases of rounding, starting and finishing may differ from the current rules | Check COURSES.md against the World Sailing rulebook (host reachable only via excerpts) |
| 33 | No starting-area rules, I/Z/U/black flags, general recalls or penalty turns | Starts are judged only for OCS | Phase 5 |
| 34 | Ferry-corridor widths and the land and mid-tide levels used by the validator are estimates | A real club course near a ferry track may be flagged more or less strictly than DHNA would | Ask DHNA; adjust `FERRY_HALF_WIDTH` |
| 31 | Tilezen tiles are a 2015-era LIDAR composite | Recent changes to the shore (new quays, slips) may be missing | Newer EA LIDAR from the EA Defra portal (host blocked) |

