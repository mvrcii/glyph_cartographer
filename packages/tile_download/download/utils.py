"""Tile calculation and geometry processing utilities for glyph.download.

Functions return detailed information about saved/skipped tiles for inspection.
"""

from __future__ import annotations

import math
import pathlib
import re
from typing import Tuple, List, Set

import geopandas as gpd
from PIL import Image
from shapely.geometry import box
from shapely.ops import unary_union


def latlon_to_tile(lat: float, lon: float, z: int) -> Tuple[int, int]:
    n = 1 << z
    xt = int((lon + 180.0) / 360.0 * n)
    yt = int((1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n)
    return xt, yt


def tile2lon(x: int, z: int) -> float:
    return x / (1 << z) * 360.0 - 180.0


def tile2lat(y: int, z: int) -> float:
    n = math.pi - (2 * math.pi * y) / (1 << z)
    return math.degrees(math.atan(0.5 * (math.exp(n) - math.exp(-n))))


def tile_bounds(x: int, y: int, z: int) -> Tuple[float, float, float, float]:
    n = 1 << z
    west = x / n * 360.0 - 180.0
    east = (x + 1) / n * 360.0 - 180.0
    north = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    south = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n))))
    return west, south, east, north


def split_and_save(img: Image.Image, z: int, x_c: int, y_c: int, size_px: int, out_root: pathlib.Path,
                   verbose: bool = False):
    tiles_per_side = size_px // 256
    tile_px = img.width // tiles_per_side
    half = tiles_per_side // 2

    x_start = x_c - half
    y_start = y_c - half

    saved_tiles = []
    skipped_tiles = []

    for i in range(tiles_per_side):
        for j in range(tiles_per_side):
            x = x_start + j
            y = y_start + i

            left = j * tile_px
            upper = i * tile_px
            crop = img.crop((left, upper, left + tile_px, upper + tile_px))

            out_path = out_root / str(z) / str(x) / f"{y}.png"
            out_path.parent.mkdir(parents=True, exist_ok=True)

            if not out_path.exists():
                crop.save(out_path, format="PNG")
                saved_tiles.append((x, y))
                if verbose:
                    print(f"  ✓ Saved tile {x},{y} → {out_path}")
            else:
                skipped_tiles.append((x, y))
                if verbose:
                    print(f"  ⏭ Skipped existing tile {x},{y}")

    return saved_tiles, skipped_tiles


def tiles_from_kml(kml_path: pathlib.Path, z: int, buffer_meters: float = 0) -> List[Tuple[int, int]]:
    gdf = gpd.read_file(kml_path).to_crs(4326)

    if buffer_meters > 0:
        gdf_utm = gdf.to_crs(gdf.estimate_utm_crs())
        gdf_utm['geometry'] = gdf_utm.geometry.buffer(buffer_meters)
        gdf = gdf_utm.to_crs(4326)

    combined_geom = unary_union(gdf.geometry.tolist())
    minx, miny, maxx, maxy = combined_geom.bounds
    x_min, y_max = latlon_to_tile(miny, minx, z)
    x_max, y_min = latlon_to_tile(maxy, maxx, z)

    tiles: Set[Tuple[int, int]] = set()
    for x in range(x_min, x_max + 1):
        for y in range(y_min, y_max + 1):
            w, s, e, n = tile_bounds(x, y, z)
            if combined_geom.intersects(box(w, s, e, n)):
                tiles.add((x, y))

    return list(tiles)


def tiles_from_txt(txt_path: pathlib.Path, z: int, mode: str = "auto") -> List[Tuple[int, int]]:
    tiles: List[Tuple[int, int]] = []
    pat = re.compile(r"[\s,]+")

    with open(txt_path, "r", encoding="utf-8") as fp:
        for ln in fp:
            ln = ln.strip()
            if not ln or ln.startswith("#"):
                continue
            parts = [p for p in pat.split(ln) if p]
            if len(parts) != 2:
                raise ValueError(f"Bad line: '{ln}' (expected 'x y' or 'lat lon')")

            try:
                a, b = float(parts[0]), float(parts[1])
            except ValueError:
                raise ValueError(f"Invalid numbers in line: '{ln}'")

            if mode == "auto":
                if abs(a) <= 180 and abs(b) <= 180:
                    x, y = latlon_to_tile(a, b, z)
                else:
                    x, y = int(a), int(b)
            elif mode == "latlon":
                x, y = latlon_to_tile(a, b, z)
            else:  # mode == "xy"
                x, y = int(a), int(b)

            tiles.append((x, y))

    return tiles
