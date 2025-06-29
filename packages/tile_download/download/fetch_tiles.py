#!/usr/bin/env python3
"""
Tile downloader using the Google Maps v1/2dtiles API.
Now GDAL-free: uses pure Python to read KML files and calculate tiles.
Supports KML, TXT, or lat/lon input. Requires API key and session token.
"""

import argparse
import asyncio
import json
import math
import os
import pathlib
import xml.etree.ElementTree as ET
from typing import List, Set, Tuple

import requests
from tqdm.asyncio import tqdm

# Load environment variables
try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass

__all__ = ["download_slippy_tiles"]


def latlon_to_tile(lat: float, lon: float, z: int) -> Tuple[int, int]:
    lat = max(min(lat, 85.05112878), -85.05112878)
    n = 1 << z
    xt = int((lon + 180.0) / 360.0 * n)
    yt = int((1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n)
    return xt, yt


def tile_to_latlon_center(x: int, y: int, z: int) -> Tuple[float, float]:
    """Returns the (lon, lat) center of a Slippy tile."""
    n = 1 << z
    lon = x / n * 360.0 - 180.0
    lat_rad = math.atan(math.sinh(math.pi * (1 - 2 * y / n)))
    lat = math.degrees(lat_rad)
    return lon, lat


def tiles_for_linestring(coords: List[Tuple[float, float]], zoom: int) -> Set[Tuple[int, int]]:
    from itertools import pairwise

    def bresenham(x0, y0, x1, y1):
        dx, dy = abs(x1 - x0), abs(y1 - y0)
        sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
        err = dx - dy
        while True:
            yield x0, y0
            if x0 == x1 and y0 == y1:
                break
            e2 = 2 * err
            if e2 > -dy:
                err -= dy
                x0 += sx
            if e2 < dx:
                err += dx
                y0 += sy

    tiles = set()
    if len(coords) == 1:
        tiles.add(latlon_to_tile(coords[0][1], coords[0][0], zoom))
        return tiles

    for (lon1, lat1), (lon2, lat2) in pairwise(coords):
        x0, y0 = latlon_to_tile(lat1, lon1, zoom)
        x1, y1 = latlon_to_tile(lat2, lon2, zoom)
        tiles.update(bresenham(x0, y0, x1, y1))
    return tiles


def parse_coordinates_from_kml(coord_text: str | None) -> List[Tuple[float, float]]:
    if not coord_text:
        return []
    coords = []
    for pair in coord_text.strip().split():
        try:
            lon, lat = map(float, pair.split(',')[:2])
            coords.append((lon, lat))
        except ValueError:
            continue
    return coords


def load_linestrings_from_kml(kml_path: pathlib.Path) -> List[List[Tuple[float, float]]]:
    ns = {'kml': 'http://www.opengis.net/kml/2.2'}
    tree = ET.parse(kml_path)
    placemarks = tree.findall('.//kml:Placemark', ns)
    linestrings = []
    for placemark in placemarks:
        ls = placemark.find('.//kml:LineString', ns)
        if ls is None:
            continue
        coords_elem = ls.find('kml:coordinates', ns)
        coords = parse_coordinates_from_kml(coords_elem.text if coords_elem is not None else None)
        if coords:
            linestrings.append(coords)
    return linestrings


def tiles_from_txt(txt_path: pathlib.Path, z: int, mode: str = "auto") -> List[Tuple[int, int]]:
    import re
    pat = re.compile(r"[\s,]+")
    tiles = []
    with open(txt_path, "r", encoding="utf-8") as fp:
        for ln in fp:
            ln = ln.strip()
            if not ln or ln.startswith("#"):
                continue
            parts = [p for p in pat.split(ln) if p]
            if len(parts) == 3:
                try:
                    z_line, x, y = int(parts[0]), int(parts[1]), int(parts[2])
                    if z_line != z:
                        continue  # Ignore mismatched zoom levels
                    tiles.append((x, y))
                except ValueError:
                    continue
            elif len(parts) == 2 and mode != "xy":
                try:
                    a, b = float(parts[0]), float(parts[1])
                except ValueError:
                    continue
                if mode == "auto":
                    if abs(a) <= 180 and abs(b) <= 180:
                        x, y = latlon_to_tile(a, b, z)
                    else:
                        x, y = int(a), int(b)
                elif mode == "latlon":
                    x, y = latlon_to_tile(a, b, z)
                else:
                    x, y = int(a), int(b)
                tiles.append((x, y))
            else:
                continue
    return tiles


def load_session_token(path: pathlib.Path = pathlib.Path("session.json")) -> str:
    if not path.exists():
        raise FileNotFoundError("Missing session.json with session token")
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data.get("session") or data.get("session_token") or ""


async def fetch_tile(x: int, y: int, z: int, out_path: pathlib.Path,
                     api_key: str, session_token: str,
                     overwrite: bool = False, verbose: bool = False) -> bool:
    if out_path.exists() and not overwrite:
        return False

    url = f"https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session={session_token}&key={api_key}"
    loop = asyncio.get_event_loop()
    response = await loop.run_in_executor(None, lambda: requests.get(url, timeout=30))
    response.raise_for_status()

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "wb") as f:
        f.write(response.content)

    if verbose:
        print(f"  ✓ Saved tile {x},{y} → {out_path}")
    return True


async def download_slippy_tiles(
    tiles: List[Tuple[int, int]],
    zoom: int,
    out_dir: pathlib.Path = pathlib.Path("data/tiles"),
    overwrite: bool = False,
    max_parallel: int = 10,
    verbose: bool = False,
):
    api_key = os.getenv("GOOGLE_MAPS_API_KEY")
    if not api_key:
        raise RuntimeError("GOOGLE_MAPS_API_KEY not found in environment")

    session_token = load_session_token()

    full_tile_list = tiles
    pending_tiles = []
    for x, y in full_tile_list:
        out_path = out_dir / str(zoom) / str(x) / f"{y}.png"
        if not out_path.exists() or overwrite:
            pending_tiles.append((x, y))
    skipped_tiles = [tile for tile in full_tile_list if tile not in pending_tiles]

    await download_tiles_parallel(
        all_tiles=full_tile_list,
        pending_tiles=pending_tiles,
        zoom=zoom,
        out_dir=out_dir,
        api_key=api_key,
        session_token=session_token,
        max_parallel=max_parallel,
        overwrite=overwrite,
        verbose=verbose,
        skipped_tiles=skipped_tiles
    )


async def download_tiles_parallel(all_tiles: List[Tuple[int, int]],
                                  pending_tiles: List[Tuple[int, int]],
                                  zoom: int,
                                  out_dir: pathlib.Path,
                                  api_key: str,
                                  session_token: str,
                                  max_parallel: int,
                                  overwrite: bool,
                                  verbose: bool,
                                  skipped_tiles) -> None:
    semaphore = asyncio.Semaphore(max_parallel)
    all_saved, all_skipped, failed_tiles = [], [], []
    pbar = tqdm(total=len(all_tiles), desc="Fetching tiles", disable=verbose)
    pbar.update(len(all_tiles) - len(pending_tiles))

    async def bounded_fetch(x: int, y: int) -> None:
        async with semaphore:
            out_path = out_dir / str(zoom) / str(x) / f"{y}.png"
            try:
                success = await fetch_tile(x, y, zoom, out_path, api_key, session_token, overwrite, verbose)
                (all_saved if success else all_skipped).append((x, y))
            except Exception as e:
                failed_tiles.append((x, y, str(e)))
                print(f"  ❌ Failed to fetch tile {x},{y}: {e}")
            finally:
                pbar.update(1)

    await asyncio.gather(*(bounded_fetch(x, y) for x, y in pending_tiles))
    pbar.close()

    print(f"\n📊 Download Summary:")
    print(f"   • {len(all_saved)} tiles downloaded")
    print(f"   • {len(skipped_tiles)} tiles skipped (already existed)")

    if failed_tiles:
        print(f"\n⚠️  {len(failed_tiles)} tile(s) failed to download:")
        for x, y, err in failed_tiles:
            print(f"   • {x},{y} → {err}")

        failed_log = out_dir / "failed_tiles.txt"
        with open(failed_log, "w") as f:
            for x, y, err in failed_tiles:
                f.write(f"{x},{y}\t{err}\n")
        print(f"   📄 Saved log to: {failed_log}")

        # Export GeoJSON
        geojson_path = out_dir / "failed_tiles.geojson"
        features = []
        for x, y, _ in failed_tiles:
            lon, lat = tile_to_latlon_center(x, y, zoom)
            features.append({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": {"x": x, "y": y, "zoom": zoom}
            })

        geojson = {
            "type": "FeatureCollection",
            "features": features
        }

        with open(geojson_path, "w", encoding="utf-8") as f:
            json.dump(geojson, f, indent=2)

        print(f"   🗺️  Saved GeoJSON to: {geojson_path}")


def console_main():
    asyncio.run(main())


async def main():
    parser = argparse.ArgumentParser(description="Download Google 2D tiles using session token and API key")
    src = parser.add_mutually_exclusive_group(required=True)
    src.add_argument("--kml", type=pathlib.Path, help="KML file with geoglyphs")
    src.add_argument("--txt", type=pathlib.Path, help="Text file with coordinates")
    src.add_argument("--lat", type=float, help="Latitude of a single tile")

    parser.add_argument("--lon", type=float, help="Longitude of a single tile (required with --lat)")
    parser.add_argument("--zoom", "-z", type=int, default=17, help="Zoom level")
    parser.add_argument("--txt-mode", choices=["auto", "latlon", "xy"], default="auto")
    parser.add_argument("--max-parallel", type=int, default=10, help="Max concurrent downloads")
    parser.add_argument("--out", type=pathlib.Path, default=pathlib.Path("data/tiles"))
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--verbose", "-v", action="store_true")

    args = parser.parse_args()

    api_key = os.getenv("GOOGLE_MAPS_API_KEY")
    if not api_key:
        parser.error("API key missing. Set GOOGLE_MAPS_API_KEY in your .env")

    try:
        session_token = load_session_token()
    except Exception as e:
        parser.error(str(e))

    if args.lat is not None and args.lon is None:
        parser.error("--lon is required with --lat")

    if args.lat is not None:
        x, y = latlon_to_tile(args.lat, args.lon, args.zoom)
        await fetch_tile(x, y, args.zoom, args.out / str(args.zoom) / str(x) / f"{y}.png",
                         api_key, session_token, args.overwrite, args.verbose)
        print("✓ Done")
        return

    if args.kml:
        linestrings = load_linestrings_from_kml(args.kml)
        tiles = set()
        for ls in linestrings:
            tiles.update(tiles_for_linestring(ls, args.zoom))
        print(f"{len(tiles)} tiles intersect LineStrings in {args.kml}")
    else:
        tiles = set(tiles_from_txt(args.txt, args.zoom, args.txt_mode))
        print(f"{len(tiles)} tiles from {args.txt}")

    full_tile_list = list(tiles)
    pending_tiles = []
    for x, y in full_tile_list:
        out_path = args.out / str(args.zoom) / str(x) / f"{y}.png"
        if not out_path.exists() or args.overwrite:
            pending_tiles.append((x, y))

    skipped_tiles = [tile for tile in full_tile_list if tile not in pending_tiles]

    await download_tiles_parallel(
        all_tiles=full_tile_list,
        pending_tiles=pending_tiles,
        zoom=args.zoom,
        out_dir=args.out,
        api_key=api_key,
        session_token=session_token,
        max_parallel=args.max_parallel,
        overwrite=args.overwrite,
        verbose=args.verbose,
        skipped_tiles=skipped_tiles
    )
    print("✓ All downloads complete")


if __name__ == "__main__":
    console_main()
