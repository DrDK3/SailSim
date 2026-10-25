"""Town detail: a finer terrain over Dartmouth and Kingswear, and buildings with roofs, party walls and bases.

Terrain: the same Environment Agency LIDAR DTM (2 m, via the z15 terrain tiles, about 3 m) resampled to 4 m over
the towns, for the picture only (the physics keeps the 8 m grid). Building bases are sampled from it too, so a
house sits on the ground where it stands, not on an 8 m average.

Roofs: OpenStreetMap roof:shape where it is tagged (very few in Dartmouth). Otherwise inferred (E): footprints
that share walls with their neighbours are terraces, roofed with a ridge parallel to the street (square to the
party walls); detached houses get a hipped roof, or a gable along their length when long and narrow; large,
irregular or utility buildings are flat. Pitches 35° (gable) and 30° (hip) are estimates. Party walls carry no
windows. Heights from the data are taken to the ridge.
"""
import math

import numpy as np
from shapely.geometry import LineString
from shapely.strtree import STRtree

import terrain

# Town box (local metres) and cell of the detail terrain.
BOX = dict(eMin=-1000.0, eMax=800.0, nMin=-1000.0, nMax=1700.0)
CELL = 4.0

FLAT_CLASSES = {"garage", "garages", "shed", "industrial", "bunker", "greenhouse", "static_caravan", "roof", "sports_centre",
                "hospital", "school", "train_station", "toilets", "shelter", "farm_auxiliary"}
GABLE_PITCH = math.radians(35)
HIP_PITCH = math.radians(30)


def detail_grid(m):
    nx = int(round((BOX["eMax"] - BOX["eMin"]) / CELL))
    ny = int(round((BOX["nMax"] - BOX["nMin"]) / CELL))
    e = BOX["eMin"] + CELL * (np.arange(nx) + 0.5)
    n = BOX["nMin"] + CELL * (np.arange(ny) + 0.5)
    E, N = np.meshgrid(e, n)
    return terrain.sample(m, E, N), nx, ny


def in_box(e, n):
    return BOX["eMin"] <= e <= BOX["eMax"] and BOX["nMin"] <= n <= BOX["nMax"]


def _axis_deg(dx, dy):
    """Compass bearing (0–180) of a line with direction (de, dn)."""
    return math.degrees(math.atan2(dx, dy)) % 180.0


def party_walls(polys):
    """For each polygon, a 0/1 flag per exterior edge: shared (within 0.6 m for 70% of its length) with another."""
    tree = STRtree(polys)
    out = []
    for i, p in enumerate(polys):
        cands = [polys[j] for j in tree.query(p.buffer(1.0)) if j != i]
        coords = list(p.exterior.coords)
        flags = []
        if not cands:
            out.append([0] * (len(coords) - 1))
            continue
        near = None
        for c in cands:
            b = c.exterior.buffer(0.6)
            near = b if near is None else near.union(b)
        for a, b in zip(coords[:-1], coords[1:]):
            seg = LineString([a, b])
            ln = seg.length
            flags.append(1 if ln > 1.0 and seg.intersection(near).length >= 0.7 * ln else 0)
        out.append(flags)
    return out


def roof(p, cls, name, osm_shape, walls):
    """Roof shape code ('g' gable, 'h' hip, 'f' flat), ridge bearing (deg, 0–180) and rise (m)."""
    rect = p.minimum_rotated_rectangle
    rc = list(rect.exterior.coords)
    s1 = math.dist(rc[0], rc[1])
    s2 = math.dist(rc[1], rc[2])
    long_axis = _axis_deg(rc[1][0] - rc[0][0], rc[1][1] - rc[0][1]) if s1 >= s2 else _axis_deg(rc[2][0] - rc[1][0], rc[2][1] - rc[1][1])
    width = min(s1, s2)
    simple = len(p.simplify(0.8).exterior.coords) - 1 <= 6 and p.area / max(rect.area, 1e-6) >= 0.8
    landmark = any(k in (name or "").lower() for k in ("castle", "church", "petrox", "saviour", "college", "chapel")) or cls in ("church", "chapel")
    shape = None
    if osm_shape in ("gabled", "hipped", "flat"):
        shape = osm_shape[0]
    elif "castle" in (name or "").lower():
        shape = "f"
    elif landmark and simple:
        shape = "g"
    elif cls in FLAT_CLASSES or p.area > 300 or not simple:
        shape = "h" if (not simple and p.area <= 300 and len(p.exterior.coords) - 1 <= 8 and cls not in FLAT_CLASSES) else "f"
    elif any(walls):
        shape = "g"
    else:
        shape = "g" if max(s1, s2) / max(width, 1e-6) >= 1.35 else "h"
    ridge = long_axis
    if shape == "g" and any(walls):
        # Ridge square to the party walls (parallel to the street), from their mean bearing (axial mean).
        coords = list(p.exterior.coords)
        sx = sy = 0.0
        for (a, b), f in zip(zip(coords[:-1], coords[1:]), walls):
            if f:
                ang = math.radians(_axis_deg(b[0] - a[0], b[1] - a[1]) * 2)
                ln = math.dist(a, b)
                sx += ln * math.cos(ang)
                sy += ln * math.sin(ang)
        ridge = (math.degrees(math.atan2(sy, sx)) / 2 + 90.0) % 180.0
    # Span: the footprint's extent square to the ridge.
    r = math.radians(ridge)
    px, py = math.cos(r), -math.sin(r)
    proj = [x * px + y * py for x, y in p.exterior.coords]
    span = max(proj) - min(proj) if shape == "g" else width
    rise = 0.0
    if shape == "g":
        rise = min(4.5, max(1.2, span / 2 * math.tan(GABLE_PITCH)))
    elif shape == "h":
        rise = min(3.5, max(1.0, span / 2 * math.tan(HIP_PITCH)))
    return shape, round(ridge), rise
