"""Phase 0 feasibility spike: summarise an Overture extract of the lower Dart.

Produces:
  * landmarks_extracted.json - named landmarks, pontoons, mooring areas, ferry routes
  * feasibility_map_osm.png  - quick-look map (not for navigation)
  * water widths across three reference lines, printed to stdout

Usage:
    python -I feasibility_report.py EXTRACT_DIR OUT_DIR
"""
import json
import math
import os
import sys

import matplotlib
import pyarrow.parquet as pq
from shapely import wkb
from shapely.geometry import LineString, box, mapping
from shapely.ops import transform, unary_union
import pyproj

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

# Local projection origin: RDYC clubhouse footprint centroid (OSM via Overture)
ORIGIN = (50.34801, -3.57339)
VIEW = box(-3.61, 50.315, -3.53, 50.385)

LANDMARK_KEYWORDS = (
    "castle", "yacht club", "petrox", "saviour", "naval college", "lifeboat",
    "railway station", "mewstone", "marina", "trots", "ferry", "jetty",
)


def load(extract_dir, name):
    return pq.read_table(os.path.join(extract_dir, f"{name}.parquet")).to_pylist()


def primary_name(row):
    return (row.get("names") or {}).get("primary")


def to_local():
    return pyproj.Transformer.from_crs(
        "EPSG:4326",
        f"+proj=tmerc +lat_0={ORIGIN[0]} +lon_0={ORIGIN[1]} +k=1 +x_0=0 +y_0=0 +ellps=WGS84",
        always_xy=True,
    ).transform


def water_mask(extract_dir):
    """OSM coastline crosses the river mouth, so river polygons must be added back."""
    land = [
        wkb.loads(r["geometry"]) for r in load(extract_dir, "land")
        if r["class"] in ("land", "island", "islet")
    ]
    land = unary_union([g.intersection(VIEW) for g in land if g.geom_type in ("Polygon", "MultiPolygon")])
    river = unary_union([
        wkb.loads(r["geometry"]).intersection(VIEW) for r in load(extract_dir, "water")
        if r["subtype"] in ("river", "ocean", "water")
        and wkb.loads(r["geometry"]).geom_type in ("Polygon", "MultiPolygon")
    ])
    return VIEW.difference(land).union(river), land.difference(river)


def landmarks(extract_dir):
    out = []
    for layer in ("building", "land_use", "land", "infrastructure", "water"):
        for r in load(extract_dir, layer):
            nm = primary_name(r)
            if not nm or not any(k in nm.lower() for k in LANDMARK_KEYWORDS):
                continue
            g = wkb.loads(r["geometry"])
            if not VIEW.intersects(g):
                continue
            lon, lat = g.centroid.coords[0]
            out.append({
                "name": nm, "layer": layer, "class": r.get("class"),
                "lat": round(lat, 6), "lon": round(lon, 6), "overture_id": r["id"],
            })
    for r in load(extract_dir, "segment"):
        if r["subtype"] != "water":
            continue
        g = wkb.loads(r["geometry"])
        if not VIEW.intersects(g):
            continue
        out.append({
            "name": primary_name(r), "layer": "segment", "class": "ferry_route",
            "geometry": mapping(g.intersection(VIEW)), "overture_id": r["id"],
        })
    return out


def main():
    extract_dir, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    tm = to_local()
    water, land = water_mask(extract_dir)
    water_local = transform(tm, water)

    for label, a, b in (
        ("Dartmouth Castle - Kingswear Castle", (-3.5658, 50.3420), (-3.5597, 50.3423)),
        ("Lower Ferry line", (-3.5775, 50.3489), (-3.5730, 50.3484)),
        ("Higher Ferry line", (-3.5765, 50.3568), (-3.5734, 50.3596)),
    ):
        seg = transform(tm, LineString([a, b]))
        print(f"{label:38s} water {seg.intersection(water_local).length:6.0f} m of {seg.length:6.0f} m line")

    lm = landmarks(extract_dir)
    with open(os.path.join(out_dir, "landmarks_extracted.json"), "w") as f:
        json.dump({
            "source": "Overture Maps Foundation release 2026-10-21.0 (OSM-derived layers, ODbL 1.0)",
            "status": "Extracted directly; positional accuracy of OSM not independently verified",
            "features": lm,
        }, f, indent=1)

    fig, ax = plt.subplots(figsize=(10, 10))
    for g in getattr(land, "geoms", [land]):
        if g.geom_type == "Polygon":
            ax.fill(*g.exterior.xy, color="#d8d2c0", lw=0.3, ec="#777")
    for r in load(extract_dir, "building"):
        g = wkb.loads(r["geometry"])
        if g.geom_type == "Polygon" and VIEW.contains(g.centroid):
            ax.fill(*g.exterior.xy, color="#a33", lw=0)
    for r in load(extract_dir, "infrastructure"):
        g = wkb.loads(r["geometry"])
        if r["subtype"] == "pier" and g.geom_type == "LineString":
            ax.plot(*g.xy, "k", lw=0.6)
    for f in lm:
        if f["class"] == "ferry_route" and f["geometry"]["type"] == "LineString":
            xs, ys = zip(*f["geometry"]["coordinates"])
            ax.plot(xs, ys, "b--", lw=0.8)
    for r in load(extract_dir, "water"):
        nm = primary_name(r) or ""
        if "Trots" in nm:
            g = wkb.loads(r["geometry"])
            ax.plot(*g.exterior.xy, "g", lw=0.8)
            ax.text(*g.centroid.coords[0], nm, fontsize=6, color="g")
    for name, (lat, lon) in {
        "RDYC": ORIGIN, "Dartmouth Castle": (50.3418, -3.56572),
        "Kingswear Castle": (50.34202, -3.55986), "BRNC": (50.35722, -3.58278),
        "Castle Ledge buoy (secondary source)": (50.33317, -3.55183),
    }.items():
        ax.plot(lon, lat, "ko", ms=3)
        ax.text(lon + 0.0005, lat + 0.0003, name, fontsize=7)
    ax.set_xlim(VIEW.bounds[0], VIEW.bounds[2])
    ax.set_ylim(VIEW.bounds[1], VIEW.bounds[3])
    ax.set_aspect(1 / math.cos(math.radians(ORIGIN[0])))
    ax.set_title("Overture/OSM extract - feasibility check (not for navigation)")
    plt.savefig(os.path.join(out_dir, "feasibility_map_osm.png"), dpi=130, bbox_inches="tight")


if __name__ == "__main__":
    main()
