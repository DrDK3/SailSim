# River Dart geodata

The River Dart in the simulator is built from open data by a reproducible pipeline, `tools/geodata/`. Its output lives in `public/geo/` and is loaded by the app at start-up. Every layer carries its source, licence and confidence tag in `public/geo/manifest.json`; the app shows them in the **Layers** panel.

> **Not for navigation.** Mid-channel depths, individual moorings, ferry timetables and the tidal stream are provisional estimates.

![Up-river from above Kingswear](img/phase3-overview.png)

## Frame and datums

| Item | Value |
|---|---|
| Horizontal | Transverse Mercator on WGS84, central meridian and origin at the RDYC clubhouse footprint centroid (50.34801° N, 3.57339° W), scale 1, no false easting/northing: `+proj=tmerc +lat_0=50.34801 +lon_0=-3.57339 +k=1 +x_0=0 +y_0=0 +ellps=WGS84`. The pipeline projects with PROJ; the app (`src/sim/geo/projection.ts`, Krüger series) agrees with PROJ to under 1 mm across the area (`tests/sim/projection.test.ts`) |
| Local axes | n = metres north, e = metres east of the origin |
| Domain | e −3200 … +3600 m, n −5200 … +4560 m (6.8 × 9.8 km: Dittisham reach to Start Bay) |
| Heights | Metres above Ordnance Datum Newlyn (ODN) |
| Chart datum | 2.62 m below ODN at Dartmouth (secondary source, issue 14). Tide heights (above chart datum) become water levels in ODN with this offset |

## Layers

| Layer | Source | How it is made | Tag |
|---|---|---|---|
| Terrain (land) | EA LIDAR Composite DTM 2 m via Tilezen terrarium tiles at z15 (≈3 m) | Sampled bilinearly at the centres of an 8 m grid | V |
| Tidal water mask | OSM coastline and riverbanks via Overture 2026-10-21.0 | Domain minus OSM land, plus river and tidal-water polygons (the OSM coastline crosses the river mouth). Only water connected to a seed point mid-river is kept | S |
| Drying areas | Same LIDAR | Inside the water mask, ground above the LIDAR water surface (−2.6 … −1.9 m ODN at the time of the survey) and below +2.5 m ODN, within 200 m of the shore | V (survey date unknown) |
| Bed below the low-water line | **Estimate** | Depth below chart datum D = Dcap·(1 − e^(−d/35 m)), d = distance from the low-water edge. Dcap = 9 m in the harbour, growing 6 m per km seaward of the castles, to 25 m. ETOPO1 values offshore (18–29 m) are a plausibility check only | **E** |
| Terrain colour | Sentinel-2 L2A true colour, 12 Jul 2025, 10 m | Resampled to the local grid; mild gamma and gain | V |
| Buildings | OSM and Microsoft ML footprints via Overture | Simplified 0.3 m. Height from the data (2,041), from floor counts (392), or by building type (2,971, E). Base at the lowest ground under the footprint (at most 4 m below the median) | S / E |
| Landmarks | OSM names and footprints | Labels at footprint centroids; real footprints only, no invented detail | S |
| Piers and pontoons | OSM `man_made=pier` | Floating if tagged so or named "Pontoon". Line widths (2.5–3 m) and fixed deck height (+3.0 m ODN) are estimates | S / E |
| Mooring areas | OSM water polygons: Kingswear, Noss and Distins Trots, DHNA anchorage | As mapped | S |
| Moorings and moored boats | **Generated** | Rows 22 m apart, buoys 16 m apart inside the mooring areas, only where the bed is below −1 m ODN; boat type and size random (seeded) | **E** |
| Ferry routes | OSM ferry routes | Clipped to the domain | S |
| Ferry timetables, vessel sizes | **Estimate** | Shuttle every 6–90 min between 07:00 and 23:00 UTC (`src/app/ferrySchedule.ts`). Lower and Higher Ferries flagged as restricted in their ability to manoeuvre (DHNA sailing directions, S(p)) | **E** |
| Navigation marks | Castle Ledge buoy only (visitmyharbour, S) | Other marks have no established position and are listed, not placed | S / N |
| Tidal stream pattern | **Model** on the estimated bed | See below | **E** |

### Tidal stream pattern (`tools/geodata/current.py`)

Tidal-prism continuity on 16 m cells at mid-tide (+0.1 m ODN):

- **Ebb.** As the tide falls at a uniform rate, every wet cell of the harbour sheds its share of water. Water from upriver (2.5 km² beyond the domain, E) drains in through the northern edge.
- **Flow.** Depth-averaged flow is potential flow. Each face carries flux T·Δφ, with T the harmonic-mean face depth. φ = 0 on the seaward edges.
- **Velocity.** The ebb velocity is −∇φ. It is normalised so the mean speed across the entrance (castle to castle) is 1.
- **River outflow.** A second pattern carries river outflow only.
- **At run time.** The app multiplies the pattern by the entrance stream from the tide timing; peaks are scenario settings, default 2.0 kn ebb and 1.5 kn flood. Flood is the reverse of ebb.

The pattern is faster in the narrows, slack in the creeks and spreads out into Start Bay:
- With 2 kn at the entrance it gives about 2 kn off RDYC and up to about 4.3 kn in the narrowest reach.
- A secondary pilot guide gives "up to about 4 kn in the narrowest part" (S). That is a cross-check, not a calibration.
- Offshore alongshore streams are not modelled.

## Files (`public/geo/`)

| File | Content | Size |
|---|---|---|
| `manifest.json` | Grids, datums, entrance line, per-layer provenance | 7 kB |
| `elevation.i16z` | Int16, centimetres ODN, 850 × 1220 cells of 8 m, rows south to north; packed (below) | 583 kB (2.1 MB unpacked) |
| `current.i16z` | Int16 × 4 components (tidal e/n, river e/n), ×0.001, 425 × 610 cells of 16 m; packed | 92 kB (2.1 MB unpacked) |
| `drape.jpg` | 680 × 976 px, 10 m | 140 kB |
| `minimap.png` | 425 × 610 px, 16 m | 110 kB |
| `features.json` | Buildings, landmarks, piers, mooring areas, moorings, ferries, marks | 700 kB |

**Packing (Phase 6).** The two grids are packed **losslessly** for download (`tools/geodata/pack.py`, unpacked by `src/sim/geo/pack.ts`; packing `i16-gradient-zigzag-planes-gzip/1`, named in the manifest):
- each value is replaced by its difference from the prediction left + up − up-left, wrapped to 16 bits;
- the differences are zigzag-coded and split into a plane of low bytes and a plane of high bytes;
- the result is gzipped. The browser unpacks it with `DecompressionStream`; a browser without it gets open water and a message.

The unpacked bytes are identical to the raw grids: `tests/sim/pack.test.ts` checks their SHA-256 against the grids built on 22 Oct 2026, and the race determinism hash is unchanged. `build.py` writes the packed files directly; `python -I tools/geodata/pack.py public/geo` packs raw `.bin` grids.

The app loads each file independently. A missing or broken file is reported and the app keeps going:

| Missing | Effect |
|---|---|
| manifest or elevation | Open water |
| drape | Plain colours |
| features | No buildings, ferries or labels |
| current | No channel stream |

## Rebuilding

```bash
python3 -m venv .venv
.venv/bin/pip install pyarrow shapely pyproj numpy pillow matplotlib scipy rasterio
.venv/bin/python -I research/geodata/extract_overture.py /path/to/extract          # Overture layers (S3, anonymous)
.venv/bin/python -I tools/geodata/build.py /path/to/extract                        # writes public/geo/ and tests/fixtures/reference-landmarks.json
npm test                                                                            # Phase 3 tests check the result
```

- **Cache:** downloads (about 140 terrain tiles, one Sentinel-2 window read over HTTP) go to `.cache/geodata/`.
- **Network:** the build needs `s3.amazonaws.com`, `overturemaps-us-west-2.s3.us-west-2.amazonaws.com` and `sentinel-cogs.s3.us-west-2.amazonaws.com`.
- **Determinism:** the outputs are deterministic for a given Overture release and scene. Only `manifest.json`'s `generated` time changes between runs.

## Checks

| Check | Result | Test |
|---|---|---|
| App projection vs PROJ | < 1 mm over the area | `tests/sim/projection.test.ts` |
| Distances between 8 reference landmarks (28 pairs) vs WGS84 geodesics from the source coordinates | worst 8 cm (criterion: 2 m) | `tests/sim/phase3.test.ts` |
| Landmarks on land above high water; mid-river and entrance deep; Castle Ledge buoy and every generated mooring in water | pass | `tests/sim/phase3.test.ts` |

## Known limitations

- **Shoreline accuracy:** the OSM shoreline is not independently verified (issue 9). The visible shoreline comes from the LIDAR terrain at the current water level, so they can differ by a few metres.
- **8 m grid:** quay walls become ramps about 8 m wide, so boats ground a few metres off a wall.
- **Unknown LIDAR survey tide:** the survey date and tide are not known, so the lower edge of the drying areas is approximate.
- **Satellite colour:** the 10 m imagery cannot show individual buildings. Its water colour shows on drying areas at low tide.
- **No obstacles yet:** moorings, pontoons and ferries do not collide with the boat yet (Phase 5).
