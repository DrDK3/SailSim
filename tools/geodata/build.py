"""Build the River Dart data set for the app: public/geo/*.

    .venv/bin/python -I tools/geodata/build.py OVERTURE_EXTRACT_DIR

OVERTURE_EXTRACT_DIR comes from research/geodata/extract_overture.py. Downloads (terrain tiles, the
Sentinel-2 window) are cached in .cache/geodata. Every output layer is described, with source, licence,
processing and confidence tag, in public/geo/manifest.json (shown in the app's attribution and provisional-
elements panels) and docs/GEODATA.md.
"""
import collections
import datetime
import json
import math
import os
import random
import sys

import numpy as np
from PIL import Image
from shapely import wkb
from shapely.affinity import rotate
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union

sys.path.insert(0, os.path.dirname(__file__))
import bathymetry  # noqa: E402
import current  # noqa: E402
import drape  # noqa: E402
import terrain  # noqa: E402
import vector  # noqa: E402
from common import (  # noqa: E402
    CD_BELOW_ODN, CELL, E_MAX, E_MIN, GEOD, GRID_E, GRID_N, N_MAX, N_MIN, NX, NY, OUT, PROJ, TO_LOCAL,
)

OVERTURE_RELEASE = "2026-10-21.0"
ODBL = "ODbL 1.0 (© OpenStreetMap contributors, via Overture Maps Foundation)"

# Reference landmarks for the acceptance test (OSM footprint or feature centroids via Overture).
REFERENCE = [
    ("Royal Dart Yacht Club", "building", "Royal Dart Yacht Club", None),
    ("Dartmouth Castle", "building", "Dartmouth Castle", 299),
    ("Kingswear Castle", "building", "Kingswear Castle", None),
    ("St Petrox Church", "building", "St. Petrox", None),
    ("St Saviour's Church", "building", "St Saviour's", None),
    ("Kingswear Railway Station", "building", "Kingswear Railway Station", None),
    ("Britannia Royal Naval College", "land_use", "Britannia Royal Naval College", None),
    ("Dartmouth Mewstone", "land", "Dartmouth Mewstone", None),
]
EXTRA_LANDMARKS = [
    ("Dart Lifeboat Station", "building", "Dart Lifeboat Station", None),
    ("Royal Castle Hotel", "building", "Royal Castle Hotel", None),
    ("Dartmouth Yacht Club", "building", "Dartmouth Yacht Club", None),
    ("Royal Dart Hotel", "building", "Royal Dart Hotel", None),
]

# Navigation marks: ONLY positions with a stated source are placed.
MARKS = [
    dict(name="Castle Ledge", kind="starboard lateral buoy", light="Fl G 5s", lat=50 + 19.99 / 60, lon=-(3 + 33.11 / 60),
         tag="S", source="visitmyharbour.com Dartmouth pilotage (secondary); check against the official list of lights / DHNA"),
]
MARKS_NOT_PLACED = [
    dict(name="Checkstone", kind="port lateral buoy", light="Fl(2) R 5s", reason="position not established (N)"),
    dict(name="Homestone", kind="port lateral buoy", light="Q R", reason="position not established (N)"),
    dict(name="Kingswear light", kind="sector light", light="Iso WRG 3s", reason="position not established (N)"),
    dict(name="RDYC racing marks", kind="club marks", light="", reason="club documents not available (N)"),
]

# Ferry services (OSM route names). Schedules and vessel sizes are ESTIMATES (E) for animation only.
FERRIES = {
    "Dartmouth Lower Ferry": dict(label="Lower Ferry (tug and float)", interval_min=7, crossing_min=4, length=33, beam=11, ram=True, units=2,
                                  note="Tug-and-float ferries are vessels restricted in their ability to manoeuvre (DHNA, S(p))."),
    "Dartmouth Higher Ferry": dict(label="Higher Ferry (chain ferry)", interval_min=6, crossing_min=5, length=50, beam=16, ram=True, units=1,
                                   note="Chain-guided; submerged chains and wires nearby (DHNA, S(p))."),
    "Dartmouth Pedestrian Ferry": dict(label="Passenger ferry Dartmouth–Kingswear", interval_min=15, crossing_min=5, length=14, beam=5, ram=False, units=1, note=""),
    "Dartmouth Castle Ferry": dict(label="Castle Ferry", interval_min=30, crossing_min=12, length=10, beam=3.5, ram=False, units=1, note="Seasonal."),
    "Dartmouth / Dittisham Ferry": dict(label="Dittisham ferry", interval_min=60, crossing_min=25, length=12, beam=4, ram=False, units=1, note=""),
    "Greenway Ferry": dict(label="Greenway ferry", interval_min=60, crossing_min=20, length=14, beam=5, ram=False, units=1, note=""),
    "Noss on Dart / Dartmouth Ferry": dict(label="Noss ferry", interval_min=60, crossing_min=12, length=10, beam=3.5, ram=False, units=1, note=""),
    "Totnes to Dartmouth Ferry": dict(label="Totnes river cruise", interval_min=90, crossing_min=75, length=25, beam=6, ram=False, units=1, note=""),
    "Dittisham Ferry": dict(label="Dittisham–Greenway foot ferry", interval_min=30, crossing_min=5, length=6, beam=2.5, ram=False, units=1, note=""),
}

# Building height when the data has none (E), by OSM building class.
CLASS_HEIGHT = {
    "house": 7.0, "detached": 7.0, "semidetached_house": 7.0, "terrace": 7.5, "residential": 7.0, "apartments": 12.0,
    "garage": 3.0, "garages": 3.0, "shed": 3.0, "roof": 3.5, "static_caravan": 3.0, "greenhouse": 3.0,
    "church": 12.0, "chapel": 9.0, "commercial": 9.0, "retail": 8.0, "office": 9.0, "hotel": 11.0,
    "industrial": 8.0, "farm_auxiliary": 6.0, "hospital": 9.0, "bunker": 3.0,
}
DEFAULT_HEIGHT = 6.5

# Provisional moorings: rows inside the mooring-area polygons (positions illustrative, E).
MOORING_ROW_SPACING = 22.0
MOORING_ALONG_SPACING = 16.0


def r1(x):
    return round(float(x), 1)


def ring(coords):
    return [[r1(e), r1(n)] for e, n in coords]


def sample_grid(grid, e, n):
    """Bilinear sample of a NY x NX cell-centred grid at local (e, n)."""
    x = (np.asarray(e) - E_MIN) / CELL - 0.5
    y = (np.asarray(n) - N_MIN) / CELL - 0.5
    i = np.clip(np.floor(x).astype(int), 0, NX - 2)
    j = np.clip(np.floor(y).astype(int), 0, NY - 2)
    fx = np.clip(x - i, 0, 1)
    fy = np.clip(y - j, 0, 1)
    return (grid[j, i] * (1 - fx) * (1 - fy) + grid[j, i + 1] * fx * (1 - fy) + grid[j + 1, i] * (1 - fx) * fy + grid[j + 1, i + 1] * fx * fy)


def find_feature(rows, name, area_hint=None):
    cands = [r for r in rows if vector.name_of(r) == name]
    if not cands:
        raise KeyError(name)
    if area_hint is not None and len(cands) > 1:
        cands.sort(key=lambda r: abs(wkb.loads(r["geometry"]).area * 1e10 - area_hint))
    return cands[0]


def landmarks(extract):
    layers = {k: vector.load(extract, k) for k in ("building", "land_use", "land")}
    out = []
    for group, items in (("reference", REFERENCE), ("extra", EXTRA_LANDMARKS)):
        for label, layer, osm_name, hint in items:
            r = find_feature(layers[layer], osm_name, hint)
            g = wkb.loads(r["geometry"])
            c = g.centroid
            e, n = TO_LOCAL.transform(c.x, c.y)
            out.append(dict(name=label, group=group, layer=layer, overture_id=r["id"], lat=round(c.y, 7), lon=round(c.x, 7), e=r1(e), n=r1(n)))
    return out


def reference_fixture(lms):
    ref = [l for l in lms if l["group"] == "reference"]
    pairs = []
    for i in range(len(ref)):
        for j in range(i + 1, len(ref)):
            a, b = ref[i], ref[j]
            _, _, d = GEOD.inv(a["lon"], a["lat"], b["lon"], b["lat"])
            pairs.append(dict(a=a["name"], b=b["name"], geodesic_m=round(d, 3)))
    return dict(
        source=f"Overture Maps {OVERTURE_RELEASE} feature centroids (OSM, ODbL); geodesic distances on WGS84 by pyproj Geod",
        landmarks=[dict(name=l["name"], lat=l["lat"], lon=l["lon"]) for l in ref],
        pairs=pairs,
    )


def buildings(extract, elev):
    out = []
    methods = collections.Counter()
    sources = collections.Counter()
    for r in vector.load(extract, "building"):
        g = vector.local(wkb.loads(r["geometry"]))
        for p in vector.polygons(g):
            c = p.centroid
            if not (E_MIN < c.x < E_MAX and N_MIN < c.y < N_MAX):
                continue
            p = p.simplify(0.3, preserve_topology=True)
            if p.is_empty or p.area < 4:
                continue
            xs, ys = p.exterior.coords.xy
            ground = sample_grid(elev, np.array(xs), np.array(ys))
            med = float(np.median(ground))
            base = max(float(ground.min()), med - 4.0) - 0.3
            if r["height"]:
                h, m = float(r["height"]), "data"
            elif r["num_floors"]:
                h, m = 3.0 * float(r["num_floors"]) + 1.5, "floors"
            else:
                h, m = CLASS_HEIGHT.get(r["class"] or "", DEFAULT_HEIGHT), "class"
            h = max(2.5, min(h, 40.0))
            methods[m] += 1
            for s in r["sources"] or []:
                sources[s.get("dataset")] += 1
            out.append(dict(b=r1(base), t=r1(med + h), r=ring(list(p.exterior.coords)[:-1]), n=vector.name_of(r) or None, c=r["class"]))
    return out, dict(methods=dict(methods), sources=dict(sources))


def piers(extract, elev):
    out = []
    for r in vector.load(extract, "infrastructure"):
        if r["subtype"] != "pier":
            continue
        g = vector.local(wkb.loads(r["geometry"]))
        if not vector.DOMAIN.intersects(g):
            continue
        t = vector.tags(r)
        name = vector.name_of(r) or ""
        floating = t.get("floating") == "yes" or "pontoon" in name.lower()
        if g.geom_type == "LineString":
            shape = dict(line=ring(g.coords), width=2.5 if floating else 3.0)
        elif g.geom_type == "Polygon":
            shape = dict(poly=ring(list(g.exterior.coords)[:-1]))
        else:
            continue
        out.append(dict(name=name or None, floating=floating, **shape))
    return out


def mooring_areas(extract):
    areas = []
    for r in vector.load(extract, "water"):
        t = vector.tags(r)
        name = vector.name_of(r) or ""
        if name.endswith("Trots") or t.get("seamark:type") == "anchorage":
            g = vector.local(wkb.loads(r["geometry"]))
            for p in vector.polygons(g.intersection(vector.DOMAIN)):
                areas.append((name or "Mooring area (DHNA)", p))
    return areas


def layout_moorings(areas, elev):
    rng = random.Random(20261022)
    out = []
    for name, p in areas:
        mrr = p.minimum_rotated_rectangle
        xs, ys = mrr.exterior.coords.xy
        edges = [(xs[i + 1] - xs[i], ys[i + 1] - ys[i]) for i in range(4)]
        dx, dy = max(edges, key=lambda v: math.hypot(*v))
        ang = math.degrees(math.atan2(dy, dx))
        c = p.centroid
        q = rotate(p.buffer(-6), -ang, origin=c)  # keep buoys 6 m inside the area
        if q.is_empty:
            continue
        minx, miny, maxx, maxy = q.bounds
        y = miny + MOORING_ROW_SPACING / 2
        while y < maxy:
            x = minx + MOORING_ALONG_SPACING / 2
            while x < maxx:
                if q.contains(Point(x, y)):
                    pt = rotate(Point(x, y), ang, origin=c)
                    bed = float(sample_grid(elev, pt.x, pt.y))
                    if bed < -1.0:  # needs some water
                        kind = rng.choices(["yacht", "motor", "keelboat"], [0.65, 0.2, 0.15])[0]
                        length = {"yacht": rng.uniform(8, 12), "motor": rng.uniform(7, 11), "keelboat": rng.uniform(5.5, 7)}[kind]
                        out.append(dict(e=r1(pt.x), n=r1(pt.y), k=kind, l=r1(length), h=round(rng.uniform(0, 360)), a=name))
                x += MOORING_ALONG_SPACING
            y += MOORING_ROW_SPACING
    return out


def ferries(extract):
    out = []
    for r in vector.load(extract, "segment"):
        if r["subtype"] != "water":
            continue
        name = vector.name_of(r)
        if name not in FERRIES:
            continue
        g = vector.local(wkb.loads(r["geometry"])).intersection(vector.DOMAIN)
        lines = [g] if g.geom_type == "LineString" else [x for x in getattr(g, "geoms", []) if x.geom_type == "LineString"]
        for ln in lines:
            if ln.length < 50:
                continue
            out.append(dict(name=name, route=ring(ln.coords), length_m=r1(ln.length), **FERRIES[name]))
    return out


def marks():
    out = []
    for m in MARKS:
        e, n = TO_LOCAL.transform(m["lon"], m["lat"])
        out.append(dict(m, e=r1(e), n=r1(n)))
    return out


def minimap(cls, elev, blds):
    """Small north-up overview image (4 elevation cells per pixel)."""
    f = 4
    c = cls[: (NY // f) * f, : (NX // f) * f]
    z = elev[: (NY // f) * f, : (NX // f) * f]
    zc = z.reshape(NY // f, f, NX // f, f).mean(axis=(1, 3))
    cc = np.round(c.reshape(NY // f, f, NX // f, f).mean(axis=(1, 3)))
    img = np.zeros(zc.shape + (3,), dtype=np.float64)
    land = np.clip(zc / 120, 0, 1)[..., None]
    img[:] = (1 - land) * np.array([168, 186, 150]) + land * np.array([120, 140, 105])
    img[cc == 1] = [205, 192, 150]
    deep = np.clip((-zc - 2.62) / 12, 0, 1)[..., None]
    sub = (1 - deep) * np.array([120, 170, 200]) + deep * np.array([40, 95, 145])
    img[cc == 2] = sub[cc == 2]
    im = Image.fromarray(np.flipud(img).astype(np.uint8))
    from PIL import ImageDraw
    d = ImageDraw.Draw(im)
    px = lambda e, n: ((e - E_MIN) / (CELL * f), (N_MAX - n) / (CELL * f))  # noqa: E731
    for b in blds:
        d.polygon([px(e, n) for e, n in b["r"]], fill=(90, 80, 78))
    return im


def main():
    extract = sys.argv[1]
    os.makedirs(OUT, exist_ok=True)
    print("terrain…", file=sys.stderr)
    dem, terrain_info = terrain.build()
    print("water mask…", file=sys.stderr)
    wm = vector.water_mask(extract)
    water = vector.rasterize([wm])
    elev, cls = bathymetry.build(dem, water)
    # Land cells below -5 m ODN are DEM artefacts (no-data blends at the LIDAR edge): fill from neighbours.
    bad = (cls == 0) & (elev < -5)
    if bad.any():
        from scipy import ndimage
        idx = ndimage.distance_transform_edt(bad, return_distances=False, return_indices=True)
        elev = elev[tuple(idx)]
    print("current field…", file=sys.stderr)
    fields, wet, cmeta = current.build(elev, water)
    print("drape…", file=sys.stderr)
    rgb, dmeta = drape.build()
    print("vectors…", file=sys.stderr)
    lms = landmarks(extract)
    blds, binfo = buildings(extract, elev)
    prs = piers(extract, elev)
    areas = mooring_areas(extract)
    moor = layout_moorings(areas, elev)
    fer = ferries(extract)
    mk = marks()

    # ---- write binary grids (little-endian Int16) ----
    q_elev = np.clip(np.round(elev * 100), -32768, 32767).astype("<i2")
    q_elev.tofile(os.path.join(OUT, "elevation.bin"))
    cur = np.stack([fields["tidal"][0], fields["tidal"][1], fields["river"][0], fields["river"][1]])
    np.clip(np.round(cur * 1000), -32768, 32767).astype("<i2").tofile(os.path.join(OUT, "current.bin"))
    Image.fromarray(rgb).save(os.path.join(OUT, "drape.jpg"), quality=86, optimize=True)
    minimap(cls, elev, blds).save(os.path.join(OUT, "minimap.png"), optimize=True)

    features = dict(
        landmarks=lms,
        buildings=blds,
        piers=prs,
        mooringAreas=[dict(name=n, ring=ring(list(p.exterior.coords)[:-1])) for n, p in areas],
        moorings=moor,
        ferries=fer,
        marks=mk,
        marksNotPlaced=MARKS_NOT_PLACED,
    )
    with open(os.path.join(OUT, "features.json"), "w") as f:
        json.dump(features, f, separators=(",", ":"))
    with open(os.path.join(os.path.dirname(__file__), "..", "..", "tests", "fixtures", "reference-landmarks.json"), "w") as f:
        json.dump(reference_fixture(lms), f, indent=1)

    a, b = bathymetry.entrance()
    manifest = dict(
        generated=datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        projection=PROJ,
        origin=dict(lat=50.34801, lon=-3.57339, name="RDYC clubhouse footprint centroid"),
        verticalDatum=dict(heights="metres above Ordnance Datum Newlyn (ODN)", chartDatumBelowOdn=CD_BELOW_ODN, chartDatumTag="S", chartDatumSource="Secondary source (issue 14); confirm against UKHO (C8)"),
        domain=dict(eMin=E_MIN, eMax=E_MAX, nMin=N_MIN, nMax=N_MAX),
        elevation=dict(file="elevation.bin", type="int16le", scale=0.01, cell=CELL, nx=NX, ny=NY, e0=E_MIN, n0=N_MIN, order="row-major, rows south to north, cell centres at e0 + (i + 0.5)·cell"),
        current=dict(file="current.bin", type="int16le", scale=0.001, components=["tidal_ve", "tidal_vn", "river_ve", "river_vn"], **cmeta,
                     meaning="Ebb direction; magnitude relative to the mean speed across the entrance (castle to castle)"),
        drape=dict(file="drape.jpg", **dmeta, e0=E_MIN, n0=N_MIN, order="image rows north to south"),
        minimap=dict(file="minimap.png", cell=CELL * 4, e0=E_MIN, n0=N_MIN, order="image rows north to south"),
        features="features.json",
        entrance=dict(a=[r1(a[0]), r1(a[1])], b=[r1(b[0]), r1(b[1])]),
        layers=layer_provenance(terrain_info, binfo, len(blds), len(prs), len(areas), len(moor), len(fer), cls),
    )
    with open(os.path.join(OUT, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=1)
    sizes = {n: os.path.getsize(os.path.join(OUT, n)) for n in sorted(os.listdir(OUT))}
    print(json.dumps(dict(sizes=sizes, buildings=binfo, moorings=len(moor), ferries=[x["name"] for x in fer], piers=len(prs)), indent=1), file=sys.stderr)


def layer_provenance(terrain_info, binfo, nb, npier, nareas, nmoor, nfer, cls):
    lidar = terrain_info["sources"]
    return [
        dict(id="terrain", label="Terrain (land)", status="data", tag="V",
             source="Environment Agency LIDAR Composite DTM 2 m via Tilezen terrain tiles (AWS Open Data), z15, resampled to 8 m",
             licence="Open Government Licence v3 (© Environment Agency copyright and/or database right 2015. All rights reserved.)",
             notes=[f"Tile sources (tile counts): {lidar}. Where LIDAR coverage ends (offshore), tiles blend EU-DEM, SRTM, GMTED and ETOPO1."]),
        dict(id="intertidal", label="Drying areas (mud, sand, rock)", status="data", tag="V",
             source="Same LIDAR DTM: ground above the water surface at the time of the survey, inside the tidal water mask",
             licence="Open Government Licence v3", notes=[f"{int((cls == 1).sum())} cells of 8 m. Survey date and tide not known: the lower limit is the survey water level, about +0.4 m above chart datum."]),
        dict(id="bathymetry", label="Water depth below the low-water line", status="provisional", tag="E",
             source="Estimate: depth grows with distance from the low-water edge (9 m cap in the harbour, rising seaward)",
             licence="—", notes=["No legally usable survey is available (Admiralty charts are UKHO copyright). Do not use for navigation.",
                                 "Grounding in the app uses this depth: it is right near the shore (LIDAR) and only indicative mid-channel."]),
        dict(id="shoreline", label="Shoreline and tidal water", status="data", tag="S",
             source=f"OpenStreetMap coastline and riverbank polygons via Overture Maps {OVERTURE_RELEASE}", licence=ODBL,
             notes=["OSM positional accuracy not independently verified; the visible shoreline comes from the LIDAR terrain at the current tide."]),
        dict(id="drape", label="Terrain colour", status="data", tag="V",
             source=f"Copernicus Sentinel-2 L2A true colour, scene {drape.SCENE} (12 Jul 2025), 10 m", licence="Contains modified Copernicus Sentinel data 2025 (free and open)",
             notes=["10 m pixels: fields, woods and towns are recognisable; individual buildings are not."]),
        dict(id="buildings", label="Buildings", status="data", tag="S",
             source=f"OpenStreetMap and Microsoft ML building footprints via Overture Maps {OVERTURE_RELEASE}", licence=ODBL + "; Microsoft ML Buildings ODbL",
             notes=[f"{nb} footprints. Heights: {binfo['methods'].get('data', 0)} from the data (Microsoft ML estimates or OSM), {binfo['methods'].get('floors', 0)} from floor counts, {binfo['methods'].get('class', 0)} estimated by building type (E). Flat roofs."]),
        dict(id="landmarks", label="Landmarks", status="data", tag="S", source=f"OSM names and footprints via Overture Maps {OVERTURE_RELEASE}", licence=ODBL,
             notes=["Shown as their real footprints with labels; no invented detail (towers, battlements)."]),
        dict(id="piers", label="Piers, jetties and pontoons", status="data", tag="S", source=f"OpenStreetMap (man_made=pier) via Overture Maps {OVERTURE_RELEASE}", licence=ODBL,
             notes=[f"{npier} features. Widths of line features and deck heights are estimates (E). Pontoons are assumed floating when tagged so or named 'Pontoon'."]),
        dict(id="mooring-areas", label="Mooring areas (trots)", status="data", tag="S", source=f"OpenStreetMap water polygons (Kingswear, Noss and Distins Trots; DHNA anchorage) via Overture Maps {OVERTURE_RELEASE}", licence=ODBL,
             notes=[f"{nareas} areas."]),
        dict(id="moorings", label="Individual moorings and moored boats", status="provisional", tag="E",
             source="Generated: rows 22 m apart, buoys 16 m apart inside the mooring areas; boat types random (seeded)", licence="—",
             notes=[f"{nmoor} moorings. Positions are illustrative: individual buoy positions are not established (N). They are not obstacles in the physics yet."]),
        dict(id="ferries", label="Ferries", status="provisional", tag="E", source=f"Routes: OpenStreetMap ferry routes via Overture Maps {OVERTURE_RELEASE} (S). Timetables and vessel sizes: estimates (E)", licence=ODBL,
             notes=[f"{nfer} route segments. Animation only: not obstacles in the physics yet. Lower and Higher Ferries are shown as restricted in their ability to manoeuvre (DHNA sailing directions, S(p))."]),
        dict(id="marks", label="Navigation marks", status="partial", tag="S", source="Only marks with a stated position are placed (Castle Ledge buoy, visitmyharbour)", licence="—",
             notes=["Not placed (position not established): Checkstone and Homestone buoys, Kingswear light, RDYC racing marks."]),
        dict(id="current", label="Tidal stream pattern", status="provisional", tag="E",
             source="Tidal-prism continuity on the provisional depths (potential flow), scaled to the entrance stream from the tide timing", licence="—",
             notes=["Not measured current data. The pattern depends on the provisional depths. Offshore (Start Bay) streams are not modelled."]),
    ]


if __name__ == "__main__":
    main()
