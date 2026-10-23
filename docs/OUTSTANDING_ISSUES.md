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
| 26 | Pontoons and piers are not obstacles (moored boats and ferries are, since Phase 5) | You can sail through pontoons | Add pier polygons to the fleet contact model |
| 27 | Individual mooring positions, ferry timetables and vessel sizes are estimates | Scenery and traffic are illustrative | Ask DHNA and the ferry operators; moorings from DHNA or aerial imagery |
| 28 | The LIDAR survey date and tide are unknown | The lower edge of the drying areas is approximate | Look up the EA survey metadata (host blocked) |
| 29 | The 8 m elevation grid turns quay walls into ramps | Boats ground a few metres off walls | Finer near-shore grid if it matters for racing |
| 30 | River Dart data is 5.1 MB uncompressed; main JS bundle 1,060 kB (303 kB gzipped) | Slower first load on mobile | Quantise and compress the grids, code-split (Phase 6) |
| 32 | The racing-rules behaviour follows secondary copies of the 2025–2028 rules (RR5–RR9); the World Sailing PDF itself could not be downloaded (network policy) | Edge cases may differ from the official text | Allow sailing.org in the environment, or check COURSES.md and RACING.md against a printed rulebook |
| 33 | Flags I and Z, postponement, abandonment, shortened course and multiple classes are not modelled (P, U, black, X and First Substitute are) | Some starting procedures cannot be practised | Add once the 2025–2028 text of rule 30.1 and 30.2 is verified and the SIs are known |
| 34 | Ferry-corridor widths and the land and mid-tide levels used by the validator are estimates | A real club course near a ferry track may be flagged more or less strictly than DHNA would | Ask DHNA; adjust `FERRY_HALF_WIDTH` |
| 31 | Tilezen tiles are a 2015-era LIDAR composite | Recent changes to the shore (new quays, slips) may be missing | Newer EA LIDAR from the EA Defra portal (host blocked) |
| 35 | AI boats are not perfectly safe. With 5 boats, 3 runs in 100 have a contact (97% clean, and 97% on hold-out seeds), mostly near the start (port–starboard crossings in the last 30 s, the committee boat) or a windward-mark touch | AI fleets occasionally collide or touch marks; the simplified judge then gives a penalty | More work on the final approach to the line and on crossings near marks (PHASE5_REPORT.md) |
| 36 | Rules subset only: no mark-room (rule 18), obstructions (19, 20), rules 15 and 16 as adjudication, exoneration, protests or hearings | Incidents at marks may be judged differently from a real protest committee | Extend after the 2025–2028 text is verified; always labelled non-authoritative |
| 37 | The estimated residuary-resistance table flattens above Fn 0.55: the model reaches 10.4 kn at 105° in 25 kn | Strong-wind reaching speeds are probably too high for a keelboat | Squib speed data (B5) or a Delft-series regression with hull parameters |
| 38 | Contact coefficients are estimates; contact has no roll, heave, damage or capsize | Collisions look and feel simplified | Acceptable for training; refine if collisions matter |
| 39 | Race committee choices that belong to the sailing instructions (finishing window 15 min, time limit 90 min, general-recall policy, U flag after a recall) are estimates | Results may differ from RDYC practice | Need the 2026 SIs (A2) |
| 40 | The AI's target speeds are the model's own polar; its tactics are heuristics tuned in the Start Bay practice area | AI behaviour on the river (tide, moorings, ferries) is less tested | River trials (`npm run ai:trials -- --river`) and tuning |
| 41 | The AI's decisions push the full-race cost to about 5 ms p99 per frame with 20 AI boats (physics alone: 2 ms; the physics budget is 3 ms) | An occasional slower frame with a big fleet on slow machines | Run the AI in a worker, or cap the candidate headings evaluated per step (Phase 6) |
| 42 | ⟨BIGFLEET_ISSUE⟩ | ⟨BIGFLEET_EFFECT⟩ | Tune the start for larger fleets (slots, spot spacing, final approach) |

