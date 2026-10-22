"""Phase 0 feasibility spike: extract Overture Maps layers for the lower River Dart.

Reads GeoParquet directly from the public Overture S3 bucket (anonymous access),
filtering on each feature's bbox column, and writes one parquet file per layer.

Usage:
    python -I extract_overture.py OUT_DIR [--release 2026-10-21.0]

Data licences (see docs/SOURCES.md): base/transportation layers derived from
OpenStreetMap are ODbL 1.0; buildings are ODbL/CDLA mixed. Attribution required.
"""
import argparse
import os
import sys
import time

import pyarrow.compute as pc
import pyarrow.dataset as ds
import pyarrow.fs as pfs
import pyarrow.parquet as pq

# lon/lat bounding box: Dittisham reach down to the approaches off the Mewstone
BBOX = (-3.62, 50.30, -3.52, 50.39)

LAYERS = {
    ("base", "water"): "id,geometry,subtype,class,names,is_salt,is_intermittent,source_tags",
    ("base", "land"): "id,geometry,subtype,class,names,source_tags",
    ("base", "land_use"): "id,geometry,subtype,class,names,source_tags",
    ("base", "land_cover"): "id,geometry,subtype,cartography",
    ("base", "infrastructure"): "id,geometry,subtype,class,names,source_tags,height",
    ("base", "bathymetry"): "id,geometry,depth,cartography",
    ("buildings", "building"): "id,geometry,subtype,class,names,height,num_floors,roof_shape,sources",
    ("transportation", "segment"): "id,geometry,subtype,class,names",
    ("places", "place"): "id,geometry,names,confidence,basic_category",
}


def extract(fs, release, theme, typ, cols, out_dir):
    w, s, e, n = BBOX
    t0 = time.time()
    dataset = ds.dataset(
        f"overturemaps-us-west-2/release/{release}/theme={theme}/type={typ}/",
        filesystem=fs,
        format="parquet",
    )
    bbox_filter = (
        (pc.field("bbox", "xmin") < e)
        & (pc.field("bbox", "xmax") > w)
        & (pc.field("bbox", "ymin") < n)
        & (pc.field("bbox", "ymax") > s)
    )
    table = dataset.to_table(filter=bbox_filter, columns=cols.split(","))
    pq.write_table(table, os.path.join(out_dir, f"{typ}.parquet"))
    print(f"{theme}/{typ}: {table.num_rows} rows in {time.time() - t0:.1f}s", file=sys.stderr)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out_dir")
    ap.add_argument("--release", default="2026-10-21.0")
    args = ap.parse_args()
    os.makedirs(args.out_dir, exist_ok=True)
    fs = pfs.S3FileSystem(anonymous=True, region="us-west-2")
    for (theme, typ), cols in LAYERS.items():
        extract(fs, args.release, theme, typ, cols, args.out_dir)


if __name__ == "__main__":
    main()
