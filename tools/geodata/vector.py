"""Vector layers from the Overture extract (OSM-derived, ODbL), projected to the local frame."""
import os

import numpy as np
import pyarrow.parquet as pq
import rasterio.features
from rasterio.transform import Affine
from shapely import wkb
from shapely.geometry import Point, box
from shapely.ops import transform, unary_union

from common import CELL, E_MAX, E_MIN, N_MAX, N_MIN, NX, NY, TO_LOCAL

DOMAIN = box(E_MIN, N_MIN, E_MAX, N_MAX)
# A point mid-river off RDYC: seeds the connected water body (navigable water connected to the sea).
WATER_SEED = Point(-150.0, 0.0)


def load(extract_dir, name):
    return pq.read_table(os.path.join(extract_dir, f"{name}.parquet")).to_pylist()


def local(g):
    return transform(lambda x, y, z=None: TO_LOCAL.transform(x, y), g)


def name_of(r):
    return (r.get("names") or {}).get("primary")


def tags(r):
    return dict(r.get("source_tags") or {})


def polygons(g):
    if g.is_empty:
        return []
    if g.geom_type == "Polygon":
        return [g]
    if g.geom_type in ("MultiPolygon", "GeometryCollection"):
        return [p for p in g.geoms if p.geom_type == "Polygon"]
    return []


def water_mask(extract_dir):
    """Tidal water connected to the sea, at about mean high water (the OSM coastline and riverbanks).

    The OSM coastline crosses the river mouth, so land polygons cover the river: subtract land, then add the
    river and tidal water polygons back. Inland ponds and reservoirs are excluded by keeping only the part
    connected to WATER_SEED.
    """
    land = []
    for r in load(extract_dir, "land"):
        if r["class"] in ("land", "island", "islet"):
            land += polygons(local(wkb.loads(r["geometry"])).intersection(DOMAIN))
    water = []
    for r in load(extract_dir, "water"):
        t = tags(r)
        keep = r["subtype"] in ("river", "ocean") or (r["subtype"] == "water" and (t.get("tidal") == "yes" or "seamark:type" in t or (name_of(r) or "").endswith("Trots")))
        if keep:
            water += polygons(local(wkb.loads(r["geometry"])).intersection(DOMAIN))
    sea = DOMAIN.difference(unary_union(land))
    merged = unary_union([sea] + water).buffer(0)
    connected = [p for p in polygons(merged) if p.intersects(WATER_SEED.buffer(50))]
    if not connected:
        raise RuntimeError("water seed is not in any water polygon")
    return unary_union(connected)


def grid_transform():
    # Row 0 = southernmost row (we store south-to-north), so use a north-up affine and flip afterwards.
    return Affine(CELL, 0, E_MIN, 0, -CELL, N_MAX)


def rasterize(geoms, all_touched=False):
    shapes = [(g, 1) for g in geoms if not g.is_empty]
    if not shapes:
        return np.zeros((NY, NX), dtype=bool)
    r = rasterio.features.rasterize(shapes, out_shape=(NY, NX), transform=grid_transform(), fill=0, all_touched=all_touched, dtype="uint8")
    return np.flipud(r).astype(bool)  # row 0 = south
