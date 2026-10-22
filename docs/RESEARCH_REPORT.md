# Phase 0 research and feasibility report

Squib Sailing Simulator: Royal Dart Yacht Club, River Dart (Kingswear and Dartmouth)

- **Date:** 22 October 2026
- **Status:** For review. No simulator code has been written yet. Only small feasibility scripts exist, in `research/`.

## 0. How to read this report

Every fact carries one of these confidence tags:

| Tag | Meaning |
|---|---|
| **V** | Verified: I inspected the primary source or dataset directly. |
| **S(p)** | Comes from the primary document, but I saw it only as a search-engine excerpt and could not open the document. It needs a direct check. |
| **S** | Supported by a secondary source (pilot guide, encyclopaedia, club or regional page). |
| **E** | Estimated for the prototype. Configurable and to be replaced. |
| **N** | Not yet established. |

### Access limitations during this phase

The cloud environment's network policy **blocked direct access** to these sites:

- `squibs.co.uk`, `royaldart.co.uk`, `dartharbour.org`
- `en.wikipedia.org`, `rya.org.uk`, `admiralty.co.uk`
- `environment.data.gov.uk`, `openstreetmap.org` and `overpass-api.de`
- YouTube

For those sources I could only see search-engine summaries. So **no club, class or harbour document has been inspected first-hand.** Anything tagged S(p) must be re-checked against the document itself (see `MISSING_INFORMATION.md`).

The environment *could* reach open-data buckets on AWS S3, GitHub, npm and PyPI. I used them for a hands-on geodata feasibility test (section 3).

Full URLs and dates are in [`SOURCES.md`](SOURCES.md).

---

## 1. The National Squib (class and boat)

| Parameter | Value | Tag | Source / note |
|---|---|---|---|
| Designer, year | Oliver Lee, 1967 | S | Wikipedia; Royal Mersey YC fleet page |
| Class authority | National Squib Owners' Association (NSOA). Owns the moulds since 1994; new hull and deck moulds 2009 | S | squibs.co.uk features page (via search) |
| Rules type | **Closed** class rules: anything not specifically permitted is prohibited | S(p) | NSOA Class Rules 2022/2024 |
| Current rules edition | A "Squib Class Rules 2025" download exists on squibs.co.uk/technical | S | **Contents N.** 2022 and 2024 editions are only partly seen |
| LOA | 19 ft (5.79 m) | S | Wikipedia, keelindex. One Irish club page says "7 m", which is treated as an error |
| LWL | 17.0 ft (5.18 m) | S | keelindex |
| Beam | 6 ft 1.5 in (1.867 m) | S | Wikipedia |
| Draft (max) | 3.25 ft (0.99 m) | S | keelindex |
| Minimum boat weight | **680 kg**, including sails and mandatory items. Up to 30 kg of corrector weights at specified points | S(p) | Class Rules 2022 excerpt; Wikipedia gives 1,500 lb (680 kg) |
| Ballast | 375 kg (827 lb), cast iron fin keel | S | keelindex (weight); Class Rules excerpt ("fine grain cast iron") |
| Keel mould changes | At hull numbers 230 and 465 | S | squibs.co.uk features page (via search) |
| Mainsail area | 10.50 m² | S(p) | NSOA features page (via search); Royal Mersey YC |
| Jib area | 6.00 m² | S(p) | as above |
| Spinnaker area | 13.50 m² (symmetric, with pole) | S(p) | as above |
| Upwind sail area total | 16.5 m² (from the two figures above). **Conflicts** with 15.8 m² (170 sq ft, Wikipedia) and 15.98 m² (172 sq ft, keelindex) | S | Difference of about 4%. Resolve from the class rules |
| Mast length | 7695 mm | S(p) | Class Rules 2022 excerpt. Datum (overall, or above deck) **N** |
| Spinnaker hoist height | 6490 mm max | S(p) | Class Rules 2022 excerpt. Implies a **fractional** spinnaker hoist |
| Spinnaker pole length | 2140 mm | S(p) | Class Rules 2022 excerpt |
| Boom outer point distance | 2743 mm (whether min or max is unclear) | S(p) | Class Rules 2024 excerpt |
| Sails carried when racing | ≤ 1 main, 1 jib, 2 spinnakers | S(p) | Class Rules 2024 excerpt |
| Mandatory kit (examples) | Bailer or bucket; anchor of 4.0–5.0 kg with 18–20 m of line | S(p) | Class Rules 2022 excerpt |
| Crew | Usually 2 (helm with main; crew with jib and spinnaker). NSOA says "two or three" | S | Royal Mersey YC; NSOA features |
| Crew weight limit | None found. NSOA mentions "a wide range of competitive crew weights" | N | Needs the class rules |
| Portsmouth Yardstick | 1142 | S | Wikipedia. **Not checked** against the current RYA list |
| Displacement hull-speed scale | ≈ 5.5 kn (1.34·√LWL in ft) | E | A rule of thumb, not a measurement |
| Hull lines or offsets | — | **N** | No public lines plan found |
| Rig details (backstay or runners, spreaders, chainplates, mast step, jib tack position, control lines) | — | **N** | Need class rules, photos or local knowledge |
| Performance data (polars, VPP, ORC certificate, logged GPS tracks) | — | **N** | Nothing found. keelindex quotes an ORC GPH of 880.1 s/nm (S), which is only a single average figure |
| Reference photos and video | — | **N** | Search returned no Squib-specific footage. YouTube is not reachable from this environment |

**What this means for the simulator:** the principal dimensions, weight and sail areas are good enough to build a credible first model. Everything hydrodynamic and aerodynamic, though, will be an **estimate** until better evidence arrives:

- hull form
- the keel and rudder planform
- the vertical and longitudinal centre of gravity
- the centres of effort and of lateral resistance
- the force coefficients
- damping and inertia

These estimates will sit in a separate calibration file. No source gives Squib boat speeds, so any speed the model produces is *model output* and cannot be called validated.

## 2. Royal Dart Yacht Club: programme, courses and marks

| Item | Finding | Tag |
|---|---|---|
| Clubhouse position | OSM building "Royal Dart Yacht Club", centroid **50.34801 N, 3.57339 W** (Overture extract). Wikidata gives 50°20′53.3″N 3°34′23.0″W (50.34814, −3.57306), about 25 m away | V (dataset) / S |
| Address | Priory Street, Kingswear | S |
| 2026 season (April–September) | Wednesday evening river series: **5 series, 24 races**. Saturday pursuit racing in Start Bay (IRC and Corinthian). Coastal series. Week of Sail. Friday evening junior dinghies on the Dart | S(p) |
| 2026 rule changes | The programme mentions **"changes to river racing for safety and a Gate on some of our courses"** | S(p), details **N** |
| Course plans, mark list, SIs (2026) | In the 2026 sailing programme PDF (`royaldart.co.uk/wp-content/uploads/2026/03/RDYC-sailing-programme-2026-compressed.pdf`) and on the Racing Noticeboard. **Could not be opened** | **N** |
| Squib fleet | Being rebuilt. 2025 plan: race as a class on Wednesdays and join other club racing at weekends. Contact: Mike Brown (NSOA Dartmouth fleet page). An older article mentions about 20 Squibs on the trots near the clubhouse | S |
| Dartmouth Classics 2025 SIs | Separate event. Appendix A has "round the cans" courses in Start Bay, with marks including *Strete* and *Memorial*, and two windward marks laid. **Not a Squib club course** | S(p) |
| National championships | RDYC hosted the 42nd Squib Nationals (year not established) | S |

**Conclusion:** I found **no official RDYC course definition**, so the course library contains **no verified club courses** yet. Phase 4 needs the 2026 programme, SIs and mark positions from you. Until then I will build only *Simulated Practice Courses*, clearly labelled.

## 3. Geography: feasibility test results

I extracted the lower Dart (lon −3.62 to −3.52, lat 50.30 to 50.39) from the **Overture Maps 2026-10-21.0** release. This is OSM-derived and licensed ODbL. The scripts are in `research/geodata/`; the map is in `docs/img/feasibility_map_osm.png`.

| Layer | Result | Tag |
|---|---|---|
| Coastline and river | OSM coastline polygons plus riverbank polygons. The coastline crosses the mouth near the castles, so river polygons have to be merged back in (done in the script). The estuary shape, Old Mill Creek and Waterhead Creek are recognisable | V (dataset) |
| Measured water widths | Dartmouth Castle–Kingswear Castle line: **≈364 m** of water. Lower Ferry line: **≈299 m**. Higher Ferry line: **≈382 m** | V (computed from OSM; OSM accuracy itself not independently checked) |
| Buildings | 5,743 footprints. Few have heights, so heights will be estimated by class | V / E |
| Named landmarks | Dartmouth Castle, Kingswear Castle, St Petrox, St Saviour's, Britannia Royal Naval College, Royal Dart YC, Dartmouth YC, Kingswear station, Dart lifeboat station, Royal Castle Hotel, Mewstone | V (dataset) |
| Pontoons and piers | 92 features, including Darthaven visitor pontoons, KP–KU pontoons, Town Jetty, Dart Marina deep-water pontoons, Hoodown depot pontoon | V (dataset) |
| Mooring areas | "Kingswear Trots", "Noss Trots" and "Distins Trots" polygons. **Individual mooring buoy positions are N** | V / N |
| Ferry tracks | Lower Ferry, Dartmouth Pedestrian Ferry, Higher Ferry, Castle Ferry, Dittisham, Greenway and Noss routes as OSM lines | V (dataset); OSM lines are schematic |
| Terrain | Tilezen terrain tiles at z15 (≈3.05 m/px). The response headers show the source as **Environment Agency LIDAR Composite DTM 2 m (SX85)**, OGL v3. Spot checks: RDYC 3 m, BRNC 58 m. At the entrance, tiles blend EA LIDAR (SX84) with EU-DEM, SRTM and GMTED where LIDAR coverage ends | V |
| Water surface in DEM | Flattened at about −2.2 m. **The DEM contains no bathymetry** | V |
| Alternatives available | Copernicus DEM GLO-30 (30 m DSM). Sentinel-2 L2A 10 m imagery (MGRS tile 30UVA) for terrain colour | V (reachable) |
| High-resolution aerial imagery | EA Vertical Aerial Photography (OGL) is a candidate, but the host is blocked. Google, Bing and Esri imagery cannot be licensed for this use | N |
| Bathymetry | Admiralty chart 2253 (cited by DHNA) is UKHO copyright and must not be digitised into a public app without a licence. UKHO INSPIRE survey data (OGL) is a candidate but blocked here. EMODnet (≈115 m) and GEBCO are far too coarse for the river | **N**, so a provisional model is needed |

Reference distances from RDYC, on a local transverse Mercator projection: Dartmouth Castle 880 m at 142°. Kingswear Castle 1,171 m at 125°. Higher Ferry Kingswear slip 1,293 m at 000°. Castle Ledge buoy, using the secondary position below, 2,254 m at 137°.

### Navigation marks and harbour rules

| Item | Finding | Tag |
|---|---|---|
| Castle Ledge buoy | Starboard lateral, Fl G 5s, **50°19.99′N 003°33.11′W** | S (visitmyharbour) |
| Checkstone buoy | Port lateral, Fl(2) R 5s. Position **N** | S |
| Homestone buoy | Port lateral, Q R, marks Homestone Ledge. Position **N** | S |
| Kingswear light | Iso WRG 3s, white sector about 325°–331° (leading line ≈328°) | S |
| Speed limit | **6 knots**, year round, from Castle Ledge buoy to Home Reach (Totnes) | S(p) (DHNA news, 2026) |
| Ferries | The Lower Ferries (tug and float) are vessels *restricted in their ability to manoeuvre*. The Higher Ferry is chain-guided, crosses just below Dart Marina, and has submerged wires nearby. The Kingswear lower ferry can be hidden when berthed. Cross-river ferries have right of way (guide) | S(p) (DHNA sailing directions) / S |
| Byelaws | Dart Harbour and Navigation Byelaws 1998, including byelaw 6 (speed) and byelaw 8 (sailing and small vessels not to obstruct the fairway). **Only headings seen** | S(p) |
| Regatta notices | Exclusion zones are announced on VHF Ch 11 (DARTNAV) | S(p) |

OSM seamark buoys exist, but Overture does not carry them, and the Overpass API was blocked. With access to `overpass-api.de` I could pull OSM buoy positions as a secondary cross-check.

## 4. Tides and currents

**Tidal height** (predicted water level) and **tidal stream** (current speed and direction) are kept strictly separate.

| Item | Finding | Tag |
|---|---|---|
| Height predictions | UKHO Admiralty EasyTide (web) and the Admiralty UK Tidal API (needs an API key, so it would need a server-side proxy). Dartmouth is a **secondary port** on Plymouth (Devonport) | S |
| HW time difference | HW Dartmouth ≈ HW Dover −05:10 (the source says it is accurate only to ±1 h) | S |
| Tidal levels (MHWS and so on) | The secondary pages give garbled figures that are identical to Plymouth's | **N** (use UKHO tables) |
| Entrance stream | "Seldom exceeds 2 knots, except after heavy rainfall or strong northerly winds when, on the ebb, it can run up to 3.5 knots" | S(p) (DHNA sailing directions) |
| Stream detail | Ebb up to about 4 kn in the narrowest part, about 1 kn outside. Flood max about 3.5 kn off Battery and Castle Points, and weak along the western shore off the entrance | S (visitmyharbour). **Conflicts** with DHNA on peak rates |
| Offshore stream (1.5 nm out) | NE-going from HW−2 to HW+4 Dartmouth; SW-going from LW−2 to LW+4 | S(p) (DHNA) |
| **Measured** current data inside the harbour | None found (no tidal diamonds, ADCP or model output accessible). A Dartmouth wave and tidal modelling report exists on dartmouthplan.org but was not accessed | **N** |
| Local practice | RDYC describes Wednesday river racing "when the tide is running" | S(p) |

**What this means for the simulator:** the current field will be a **documented scenario model**. Its flow follows the channel axis, scaled by channel cross-section and a tidal-phase curve, with peak magnitudes set as scenario parameters (default ≈2 kn at the entrance on springs). It will be labelled *provisional, not measured* throughout the UI. It will also be replaceable by a gridded field if real data arrives.

## 5. Racing rules

The **Racing Rules of Sailing 2025–2028** took effect on 1 January 2025. The main tactical change is to rule 18 (mark-room, "first to the zone"). The definitions of *Obstruction* and *Proper Course* were also amended. (S: RYA, US Sailing and Scuttlebutt summaries. The World Sailing rulebook text was not inspected.)

Any rules logic will be a simplified subset and will be labelled *not an authoritative adjudication system*.

## 6. Feasibility verdict

| Goal | Feasible now? | Limiting factor |
|---|---|---|
| Credible 3D Squib and physics engine | **Yes** | Coefficients are estimates. There is no validation data |
| Geographically grounded Dart (shoreline, terrain, buildings, landmarks, pontoons, ferries) | **Yes**, from open data I have already tested | Aerial imagery is 10 m only. OSM accuracy is unverified |
| Bathymetry and grounding | Provisional only | No open high-resolution survey reachable |
| Tidal heights | Manual entry now; an API later | UKHO licence and key |
| Tidal currents | Provisional scenario model only | No measured data |
| Verified RDYC courses | **Not yet** | Need the 2026 programme, SIs and mark positions |
| Browser deployment | **Yes** | Static hosting; no paid services needed for the core app |
