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
import pack  # noqa: E402
import terrain  # noqa: E402
import town  # noqa: E402
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
# A building stands at least this share of its height above the uphill ground round its walls (E).
UPHILL_SHARE = 0.7

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


def buildings(extract, elev, mosaic=None):
    """Footprints with base, eaves and top heights (m ODN), roof shape and ridge bearing, party walls, floors.

    Base: the lowest ground under the footprint (at most 4 m below the median), from the ~3 m LIDAR terrain in the
    town box (town.py) and the 8 m grid elsewhere. Top: median ground + height (to the ridge), but at least 70% of
    the height above the uphill ground (the 90th percentile round the walls): on a steep site a house stands up
    from its uphill street rather than sinking into the slope (a rule, E; heights are not defined for slopes).
    """
    rows = []
    methods = collections.Counter()
    sources = collections.Counter()
    roofs = collections.Counter()
    raised = 0
    for r in vector.load(extract, "building"):
        g = vector.local(wkb.loads(r["geometry"]))
        for p in vector.polygons(g):
            c = p.centroid
            if not (E_MIN < c.x < E_MAX and N_MIN < c.y < N_MAX):
                continue
            p = p.simplify(0.3, preserve_topology=True)
            if p.is_empty or p.area < 4:
                continue
            rows.append((r, p))
    walls = town.party_walls([p for _, p in rows])
    out = []
    for (r, p), w in zip(rows, walls):
        c = p.centroid
        # Ground along the edges (every ~2 m) and at the centre.
        pts = [p.exterior.interpolate(d) for d in np.arange(0, p.exterior.length, 2.0)] + [c]
        xs = np.array([q.x for q in pts])
        ys = np.array([q.y for q in pts])
        fine = mosaic is not None and town.in_box(c.x, c.y)
        ground = terrain.sample(mosaic, xs, ys) if fine else sample_grid(elev, xs, ys)
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
        name = vector.name_of(r) or None
        shape, ridge, rise = town.roof(p, r["class"], name, r.get("roof_shape"), w)
        roofs[shape] += 1
        top = med + h
        uphill = float(np.percentile(ground, 90))
        if uphill + UPHILL_SHARE * h > top:
            top = uphill + UPHILL_SHARE * h
            raised += 1
        eaves = max(base + 2.4, top - rise) if shape != "f" else top
        rec = dict(b=r1(base), t=r1(top), r=ring(list(p.exterior.coords)[:-1]), n=name, c=r["class"], s=shape)
        if shape != "f":
            rec.update(e=r1(eaves), d=ridge)
        if any(w):
            rec["w"] = "".join(str(x) for x in w)
        if r["num_floors"]:
            rec["f"] = int(r["num_floors"])
        out.append(rec)
    return out, dict(methods=dict(methods), sources=dict(sources), roofs=dict(roofs), partyWalls=sum(1 for w in walls if any(w)), fine=mosaic is not None, raisedOnSlopes=raised)


def water_distance(wm):
    """Signed distance (m) to the tidal water outline on the 8 m grid, > 0 in the water: from a 2 m raster of the
    outline, averaged over each cell. Rows north to south (for the PNG the renderer reads)."""
    from scipy import ndimage
    import rasterio.features
    from rasterio.transform import Affine
    S = 4
    tr = Affine(CELL / S, 0, E_MIN, 0, -CELL / S, N_MAX)
    inside = rasterio.features.rasterize([(wm, 1)], out_shape=(NY * S, NX * S), transform=tr, fill=0, dtype="uint8").astype(bool)
    d = np.where(inside, ndimage.distance_transform_edt(inside), -ndimage.distance_transform_edt(~inside)) * (CELL / S)
    return d.reshape(NY, S, NX, S).mean(axis=(1, 3))


# Marinas mapped in OSM only as a named place (no leisure=marina area): the place names it, its pontoons place it.
MARINA_PLACES = {"Noss Marina": "Noss on Dart Marina"}


def marinas(extract, prs):
    """Marinas (OSM leisure=marina via Overture land_use): name and centre. Plus marinas named only as places,
    centred on their floating pontoons (OSM) within 350 m of the place."""
    out = []
    for r in vector.load(extract, "land_use"):
        if r["class"] != "marina" or not vector.name_of(r):
            continue
        c = vector.local(wkb.loads(r["geometry"])).centroid
        if E_MIN < c.x < E_MAX and N_MIN < c.y < N_MAX:
            out.append(dict(name=vector.name_of(r), e=r1(c.x), n=r1(c.y)))
    for r in vector.load(extract, "place"):
        name = MARINA_PLACES.get(vector.name_of(r))
        if not name:
            continue
        p = vector.local(wkb.loads(r["geometry"]))
        pts = [q for x in prs if x["floating"] for q in (x.get("line") or x.get("poly")) if np.hypot(q[0] - p.x, q[1] - p.y) < 350]
        if pts:
            out.append(dict(name=name, e=r1(np.mean([q[0] for q in pts])), n=r1(np.mean([q[1] for q in pts]))))
    return sorted(out, key=lambda m: m["name"])


def railway(extract, elev):
    """Railway lines (OSM railway=rail via Overture segments), clipped to the domain, and stations with their
    platforms and buildings. A tunnel is not flagged in the data: the DTM is bare earth, so a line is taken as
    in tunnel where the ground stands well above a straight line between its ends for most of its length."""
    lines = []
    for r in vector.load(extract, "segment"):
        if r["subtype"] != "rail":
            continue
        g = vector.local(wkb.loads(r["geometry"])).intersection(vector.DOMAIN)
        for ln in [g] if g.geom_type == "LineString" else [x for x in getattr(g, "geoms", []) if x.geom_type == "LineString"]:
            if ln.length < 5:
                continue
            d = np.linspace(0, ln.length, max(3, int(ln.length / 5)))
            pts = [ln.interpolate(x) for x in d]
            z = sample_grid(elev, [q.x for q in pts], [q.y for q in pts])
            above = z - np.linspace(z[0], z[-1], len(z))
            tunnel = bool(ln.length > 100 and np.mean(above > 12) > 0.6)
            lines.append(dict(name=vector.name_of(r) or "", line=ring(ln.coords), tunnel=tunnel))
    stations = []
    infra = vector.load(extract, "infrastructure")
    for r in infra:
        if r.get("class") != "railway_station":
            continue
        p = vector.local(wkb.loads(r["geometry"]))
        if not vector.DOMAIN.contains(p):
            continue
        near = lambda g: g.distance(p) < 300
        platforms = [ring(list(g.exterior.coords)[:-1]) for g in (vector.local(wkb.loads(x["geometry"])) for x in infra if x.get("class") == "platform") if g.geom_type == "Polygon" and near(g)]
        blds = [ring(list(g.exterior.coords)[:-1]) for g in (vector.local(wkb.loads(x["geometry"])) for x in vector.load(extract, "building") if x.get("class") == "train_station") if g.geom_type == "Polygon" and near(g)]
        stations.append(dict(name=vector.name_of(r), e=r1(p.x), n=r1(p.y), platforms=platforms, buildings=blds))
    return dict(lines=lines, stations=stations)


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
    """North-up overview image (2 elevation cells = 16 m per pixel)."""
    f = 2
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
        d.polygon([px(e, n) for e, n in b["r"]], fill=(150, 138, 126))
    return im


def main():
    extract = sys.argv[1]
    os.makedirs(OUT, exist_ok=True)
    print("terrain…", file=sys.stderr)
    mosaic = terrain.mosaic()
    dem, terrain_info = terrain.build(mosaic)
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
    blds, binfo = buildings(extract, elev, mosaic)
    town_grid, tnx, tny = town.detail_grid(mosaic)
    prs = piers(extract, elev)
    mar = marinas(extract, prs)
    rail = railway(extract, elev)
    areas = mooring_areas(extract)
    moor = layout_moorings(areas, elev)
    fer = ferries(extract)
    mk = marks()

    # ---- write binary grids (Int16, packed losslessly for download: pack.py) ----
    q_elev = np.clip(np.round(elev * 100), -32768, 32767).astype("<i2")
    with open(os.path.join(OUT, "elevation.i16z"), "wb") as f:
        f.write(pack.pack_grid(q_elev, NX, NY))
    cur = np.stack([fields["tidal"][0], fields["tidal"][1], fields["river"][0], fields["river"][1]])
    q_cur = np.clip(np.round(cur * 1000), -32768, 32767).astype("<i2")
    with open(os.path.join(OUT, "current.i16z"), "wb") as f:
        f.write(pack.pack_grid(q_cur, cmeta["nx"], cmeta["ny"]))
    q_town = np.clip(np.round(town_grid * 100), -32768, 32767).astype("<i2")
    with open(os.path.join(OUT, "town.i16z"), "wb") as f:
        f.write(pack.pack_grid(q_town, tnx, tny))
    Image.fromarray(rgb).save(os.path.join(OUT, "drape.jpg"), quality=86, optimize=True)
    minimap(cls, elev, blds).save(os.path.join(OUT, "minimap.png"), optimize=True)
    wd = water_distance(wm)
    Image.fromarray(np.clip(np.round(128 + 2 * wd), 0, 255).astype(np.uint8), "L").save(os.path.join(OUT, "watermask.png"), optimize=True)

    features = dict(
        landmarks=lms,
        buildings=blds,
        piers=prs,
        mooringAreas=[dict(name=n, ring=ring(list(p.exterior.coords)[:-1])) for n, p in areas],
        moorings=moor,
        marinas=mar,
        railway=rail,
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
        elevation=dict(file="elevation.i16z", type="int16le", scale=0.01, cell=CELL, nx=NX, ny=NY, e0=E_MIN, n0=N_MIN, order="row-major, rows south to north, cell centres at e0 + (i + 0.5)·cell",
                       packing=pack.PACKING),
        current=dict(file="current.i16z", type="int16le", scale=0.001, components=["tidal_ve", "tidal_vn", "river_ve", "river_vn"], **cmeta,
                     meaning="Ebb direction; magnitude relative to the mean speed across the entrance (castle to castle)", packing=pack.PACKING),
        drape=dict(file="drape.jpg", **dmeta, e0=E_MIN, n0=N_MIN, order="image rows north to south"),
        town=dict(file="town.i16z", type="int16le", scale=0.01, cell=town.CELL, nx=tnx, ny=tny, e0=town.BOX["eMin"], n0=town.BOX["nMin"],
                  order="row-major, rows south to north, cell centres at e0 + (i + 0.5)·cell", packing=pack.PACKING,
                  meaning="Ground (m ODN) over Dartmouth and Kingswear for the picture: the same LIDAR DTM at 4 m (the physics uses the 8 m grid)"),
        minimap=dict(file="minimap.png", cell=CELL * 2, e0=E_MIN, n0=N_MIN, order="image rows north to south"),
        waterMask=dict(file="watermask.png", cell=CELL, nx=NX, ny=NY, e0=E_MIN, n0=N_MIN, order="image rows north to south, cell centres at e0 + (i + 0.5)·cell",
                       encoding="signed distance (m) to the tidal water outline (shoreline layer) = (v - 128) / 2, > 0 in the water, clamped to about ±64 m",
                       meaning="Where the picture may draw the water surface: tidal water and the bank next to it, not low ground inland"),
        features="features.json",
        entrance=dict(a=[r1(a[0]), r1(a[1])], b=[r1(b[0]), r1(b[1])]),
        layers=layer_provenance(terrain_info, binfo, len(blds), len(prs), len(areas), len(moor), len(fer), cls),
    )
    with open(os.path.join(OUT, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=1)
    sizes = {n: os.path.getsize(os.path.join(OUT, n)) for n in sorted(os.listdir(OUT))}
    print(json.dumps(dict(sizes=sizes, buildings=binfo, moorings=len(moor), ferries=[x["name"] for x in fer], piers=len(prs), marinas=mar,
                     railway=dict(lines=[(x["name"], len(x["line"]), x["tunnel"]) for x in rail["lines"]], stations=[(x["name"], len(x["platforms"]), len(x["buildings"])) for x in rail["stations"]])), indent=1), file=sys.stderr)


def layer_provenance(terrain_info, binfo, nb, npier, nareas, nmoor, nfer, cls):
    lidar = terrain_info["sources"]
    return [
        dict(id="terrain", label="Terrain (land)", status="data", tag="V",
             source="Environment Agency LIDAR Composite DTM 2 m via Tilezen terrain tiles (AWS Open Data), z15, resampled to 8 m",
             licence="Open Government Licence v3 (© Environment Agency copyright and/or database right 2015. All rights reserved.)",
             notes=[f"Tile sources (tile counts): {lidar}. Where LIDAR coverage ends (offshore), tiles blend EU-DEM, SRTM, GMTED and ETOPO1.",
                    "Over Dartmouth and Kingswear the picture uses the same LIDAR at 4 m (town.i16z); the physics keeps the 8 m grid."]),
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
             notes=[f"{nb} footprints. Heights: {binfo['methods'].get('data', 0)} from the data (Microsoft ML estimates or OSM), {binfo['methods'].get('floors', 0)} from floor counts, {binfo['methods'].get('class', 0)} estimated by building type (E).",
                    "Bases on the LIDAR ground (about 3 m in the towns). Roofs: OSM roof:shape where tagged; otherwise inferred (E) - terraces (shared party walls) "
                    f"gabled along the street, detached houses hipped or gabled, large and utility buildings flat ({binfo['roofs']}; {binfo['partyWalls']} with party walls). "
                    "Measured roof shapes need the Environment Agency LIDAR surface model (environment.data.gov.uk, not reachable from the build environment)."]),
        dict(id="landmarks", label="Landmarks", status="data", tag="S", source=f"OSM names and footprints via Overture Maps {OVERTURE_RELEASE}", licence=ODBL,
             notes=["Shown as their real footprints with labels; churches roofed as gables along their length and castles flat (E). No invented towers or battlements."]),
        dict(id="piers", label="Piers, jetties and pontoons", status="data", tag="S", source=f"OpenStreetMap (man_made=pier) via Overture Maps {OVERTURE_RELEASE}", licence=ODBL,
             notes=[f"{npier} features. Widths of line features and deck heights are estimates (E). Pontoons are assumed floating when tagged so or named 'Pontoon'."]),
        dict(id="mooring-areas", label="Mooring areas (trots)", status="data", tag="S", source=f"OpenStreetMap water polygons (Kingswear, Noss and Distins Trots; DHNA anchorage) via Overture Maps {OVERTURE_RELEASE}", licence=ODBL,
             notes=[f"{nareas} areas."]),
        dict(id="moorings", label="Individual moorings and moored boats", status="provisional", tag="E",
             source="Generated: rows 22 m apart, buoys 16 m apart inside the mooring areas; boat types random (seeded)", licence="—",
             notes=[f"{nmoor} moorings. Positions are illustrative: individual buoy positions are not established (N). They are not obstacles in the physics yet."]),
        dict(id="ferries", label="Ferries", status="provisional", tag="E", source=f"Routes: OpenStreetMap ferry routes via Overture Maps {OVERTURE_RELEASE} (S). Timetables and vessel sizes: estimates (E)", licence=ODBL,
             notes=[f"{nfer} route segments. Animation only: not obstacles in the physics yet. Lower and Higher Ferries are shown as restricted in their ability to manoeuvre (DHNA sailing directions, S(p))."]),
        dict(id="railway", label="Railway and Kingswear station", status="data", tag="S",
             source=f"OpenStreetMap railway lines, platform and station via Overture Maps {OVERTURE_RELEASE}", licence=ODBL,
             notes=["Track level follows the LIDAR ground; the tunnel is inferred from the ground rising far above the line (E).",
                    "Trains and their times: see the timetable notes in the app (docs/SOURCES.md)."]),
        dict(id="marks", label="Navigation marks", status="partial", tag="S", source="Only marks with a stated position are placed (Castle Ledge buoy, visitmyharbour)", licence="—",
             notes=["Not placed (position not established): Checkstone and Homestone buoys, Kingswear light, RDYC racing marks."]),
        dict(id="current", label="Tidal stream pattern", status="provisional", tag="E",
             source="Tidal-prism continuity on the provisional depths (potential flow), scaled to the entrance stream from the tide timing", licence="—",
             notes=["Not measured current data. The pattern depends on the provisional depths. Offshore (Start Bay) streams are not modelled."]),
    ]


if __name__ == "__main__":
    main()
