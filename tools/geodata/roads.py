"""Roads and footways for the picture: OSM highways via the Overture extract, clipped to the domain, simplified,
written to public/geo/roads.json, and listed in manifest.json (its `roads` entry and layer provenance).

    .venv/bin/python tools/geodata/roads.py OVERTURE_EXTRACT_DIR

Kept apart from build.py so that adding roads does not rebuild the terrain. The app draws the road surfaces and,
as illustration (E), cars on the roads and people on the footways (src/render/population.ts).
"""
import json
import os
import sys

from shapely import wkb

sys.path.insert(0, os.path.dirname(__file__))
import vector  # noqa: E402
from build import ODBL, OUT, OVERTURE_RELEASE, ring  # noqa: E402

# OSM highway classes kept, with the short code the app reads.
CLASSES = {
    "primary": "p", "secondary": "s", "tertiary": "t", "unclassified": "u", "residential": "r",
    "living_street": "l", "service": "v", "pedestrian": "w", "footway": "f", "steps": "x",
}


def roads(extract):
    out = []
    for r in vector.load(extract, "segment"):
        code = CLASSES.get(r.get("class") or "")
        if r["subtype"] != "road" or not code:
            continue
        g = vector.local(wkb.loads(r["geometry"])).intersection(vector.DOMAIN)
        for ln in [g] if g.geom_type == "LineString" else [x for x in getattr(g, "geoms", []) if x.geom_type == "LineString"]:
            if ln.length < 4:
                continue
            ln = ln.simplify(0.8, preserve_topology=False)
            item = dict(c=code, l=ring(ln.coords))
            name = vector.name_of(r)
            if name:
                item["n"] = name
            out.append(item)
    return out


def main():
    extract = sys.argv[1]
    rd = roads(extract)
    with open(os.path.join(OUT, "roads.json"), "w") as f:
        json.dump(dict(roads=rd), f, separators=(",", ":"))
    path = os.path.join(OUT, "manifest.json")
    with open(path) as f:
        manifest = json.load(f)
    manifest["roads"] = dict(file="roads.json", classes={v: k for k, v in CLASSES.items()})
    layer = dict(id="roads", label="Roads and footways", status="data", tag="S",
                 source=f"OpenStreetMap highways via Overture Maps {OVERTURE_RELEASE}", licence=ODBL,
                 notes=[f"{len(rd)} segments. Road widths are estimates by class (E).",
                        "Cars on the roads and people on the footways and quays are illustrative (E): their numbers and movements are not data."])
    manifest["layers"] = [x for x in manifest["layers"] if x.get("id") != "roads"] + [layer]
    with open(path, "w") as f:
        json.dump(manifest, f, indent=1)
    by = {}
    for x in rd:
        by[x["c"]] = by.get(x["c"], 0) + 1
    print(json.dumps(dict(segments=len(rd), by_class=by, bytes=os.path.getsize(os.path.join(OUT, "roads.json")))))


if __name__ == "__main__":
    main()
