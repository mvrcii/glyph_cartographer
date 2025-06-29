#!/usr/bin/env python3
"""
create_dataset.py  —  Multi-scale version

Extracts multi-scale patches + binary labels from a slippy tile dataset
using all CPU cores. This script incorporates advanced features like atomic
saves, rich metadata collection, and a post-creation sanity check.

This script relies on a 'configs.py' file in the same directory or python path
to provide the 'Config' class for loading run configurations.

Assumes a slippy tile structure for images and labels:
- Images: data/tiles/17/<x>/<y>.png (assumed to be 512x512)
- Labels: data/labels/17/<x>/<y>.png (assumes a 1:1 match with images)

Usage:
    python create_dataset.py /path/to/your/config.py
"""

from __future__ import annotations

import argparse
import os
import sys
import tempfile
from multiprocessing import Pool, cpu_count
from pathlib import Path
from typing import List, Tuple

import cv2
import numpy as np
import pandas as pd
from shapely.geometry import box
from tqdm import tqdm

# Use the provided Config class by importing it.
# Assumes 'configs.py' is in the same directory or in the PYTHONPATH.
from glyph.utility.configs import Config


# --- New Dependencies ---
# This script now requires opencv-python, shapely, and pandas.
# You can install them with:
# pip install opencv-python shapely pandas

# ───────────────── Helpers from KML Script ───────────────── #

def get_tile_bbox(z: int, x: int, y: int):
    """Calculates the WGS84 bounding box for a slippy tile."""
    n = 2 ** z
    lon_deg_left = x / n * 360.0 - 180.0
    lon_deg_right = (x + 1) / n * 360.0 - 180.0
    lat_rad_top = np.pi - 2.0 * np.pi * y / n
    lat_rad_bottom = np.pi - 2.0 * np.pi * (y + 1) / n
    lat_deg_top = np.degrees(np.arctan(np.sinh(lat_rad_top)))
    lat_deg_bottom = np.degrees(np.arctan(np.sinh(lat_rad_bottom)))
    return box(lon_deg_left, lat_deg_bottom, lon_deg_right, lat_deg_top)


def atomic_save(arr: np.ndarray, path: Path) -> None:
    """Safely saves a numpy array by writing to a temp file before moving."""
    if path.exists():
        return
    # Use a temporary file to avoid data corruption
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False, suffix=".tmp") as tmp:
        np.save(tmp, arr, allow_pickle=False)
        tmp_path = Path(tmp.name)
    # Rename the file to its final destination
    os.replace(tmp_path, path)


def expected_bits_from_fname(fname: str) -> int:
    """Calculates the expected number of bits for a label from its filename."""
    size = int(fname.split('_s')[1].split('.npy')[0])
    return (size // 4) ** 2


# ─────────────────── Core Functions ─────────────────── #

def load_image_rgb(path: str | Path) -> np.ndarray:
    """Loads an image, converts to RGB, and asserts its size."""
    # Using OpenCV to be consistent with KML script
    img = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if img is None:
        raise IOError(f"Failed to load image at {path}")
    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    # The multi-scale logic assumes a fixed input tile size
    assert img_rgb.shape[:2] == (512, 512), f"Expect 512x512 tile, got {img_rgb.shape} from {path}"
    return img_rgb


def load_label_binary(path: str | Path) -> np.ndarray:
    """Loads a label image and converts it to a binary NumPy array."""
    # Using OpenCV for consistency
    label_img = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    if label_img is None:
        raise IOError(f"Failed to load label at {path}")
    assert label_img.shape[:2] == (512, 512), f"Expect 512x512 label, got {label_img.shape} from {path}"
    return (label_img > 127)


def process_tile(
        args: Tuple[
            Path, Path, int, int, int,
            Path, Path, List[int], List[int]
        ]
) -> List[dict]:
    """
    Worker function: extracts multi-scale patches from a single tile.
    """
    (
        tile_path, label_path, z, x, y,
        images_out_dir, labels_out_dir, subpatch_sizes, subpatch_strides
    ) = args

    if not label_path.exists():
        return []

    try:
        tile_rgb = load_image_rgb(tile_path)
        mask_full = load_label_binary(label_path)
    except (IOError, AssertionError) as e:
        print(f"Warning: Skipping tile {tile_path.name} due to error: {e}")
        return []

    tile_bbox_geo = get_tile_bbox(z, x, y)
    records: List[dict] = []

    # --- FEATURE: Multi-Scale Patch Extraction using zip ---
    # Iterate over each size and its corresponding stride
    for size, stride in zip(subpatch_sizes, subpatch_strides):
        for y0 in range(0, 512 - size + 1, stride):
            for x0 in range(0, 512 - size + 1, stride):
                img_patch = tile_rgb[y0:y0 + size, x0:x0 + size]
                lbl_patch = mask_full[y0:y0 + size, x0:x0 + size]

                # --- FEATURE: Dynamic Label Downsampling ---
                lbl_target_size = size // 4
                if lbl_patch.shape[0] != lbl_target_size:
                    lbl_patch_ds = cv2.resize(
                        lbl_patch.astype(np.uint8) * 255,
                        (lbl_target_size, lbl_target_size),
                        interpolation=cv2.INTER_NEAREST,
                    ) > 127
                else:
                    lbl_patch_ds = lbl_patch

                # Create a unique name including scale information
                patch_name = f"z{z}_x{x}_y{y}_px{x0}_py{y0}_s{size}.npy"
                img_chw = np.transpose(img_patch, (2, 0, 1))
                lbl_bits = np.packbits(lbl_patch_ds.flatten())

                # --- FEATURE: Atomic Saving ---
                atomic_save(img_chw, images_out_dir / patch_name)
                atomic_save(lbl_bits, labels_out_dir / patch_name)

                # --- FEATURE: Rich Metadata Collection ---
                glyph_p = lbl_patch_ds.mean() * 100.0
                records.append(dict(
                    filename=patch_name,
                    glyph_p=glyph_p,
                    patch_size=size,
                    label_size=lbl_target_size,
                    zoom=z,
                    tile_x=x,
                    tile_y=y,
                    lat_center=(tile_bbox_geo.bounds[1] + tile_bbox_geo.bounds[3]) / 2,
                    lon_center=(tile_bbox_geo.bounds[0] + tile_bbox_geo.bounds[2]) / 2,
                ))
    return records


def sanity_check(records: List[dict], images_dir: Path, labels_dir: Path, n: int = 25):
    """Randomly checks n patches to ensure they were written correctly."""
    if not records:
        print("No patches produced; skipping sanity check.")
        return
    # Ensure n is not larger than the number of records
    n_to_check = min(n, len(records))
    # Get random indices without replacement
    random_indices = np.random.choice(len(records), size=n_to_check, replace=False)

    for i in random_indices:
        rec = records[i]
        try:
            img = np.load(images_dir / rec["filename"])
            lbl = np.load(labels_dir / rec["filename"])
            assert img.shape[1] == img.shape[2] == rec["patch_size"]
            assert np.unpackbits(lbl).size == expected_bits_from_fname(rec["filename"])
        except Exception as e:
            print(f"\nERROR: Sanity check failed for patch {rec['filename']}!")
            raise e

    print(f"✓ Sanity check passed on {n_to_check} random patches.")


# ───────────────────────── main ───────────────────────── #

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Multi-scale slippy-tile dataset creator.")
    p.add_argument("config_path", help="Path to configuration Python file (.py)")
    p.add_argument("--workers", type=int, default=cpu_count(), help="Number of parallel workers")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    cfg = Config.load_from_file(args.config_path)
    print(f"Successfully loaded configuration from '{args.config_path}'")

    # Define root directories from config
    data_root = Path(cfg.data_root_dir)
    target_root = Path(cfg.dataset_target_dir)
    images_dir = target_root / "images"
    labels_dir = target_root / "labels"
    images_dir.mkdir(parents=True, exist_ok=True)
    labels_dir.mkdir(parents=True, exist_ok=True)

    tiles_root = data_root / "tiles"
    labels_root = data_root / "labels"
    zoom_level = "17"

    # Find all image tiles
    tile_paths = sorted(list(tiles_root.glob(f"{zoom_level}/*/*.png")))
    if not tile_paths:
        print(f"Error: No images found at '{tiles_root / zoom_level}'. Please check the path.")
        return
    print(f"Found {len(tile_paths)} image tiles to process.")

    # --- CONFIGURATION VALIDATION ---
    # Get strides from config. If not present, default to making patches non-overlapping.
    subpatch_strides = getattr(cfg, 'subpatch_strides', cfg.subpatch_sizes)

    # Ensure the number of strides matches the number of patch sizes
    if len(subpatch_strides) != len(cfg.subpatch_sizes):
        print(
            f"Error: The number of items in 'subpatch_strides' ({len(subpatch_strides)}) "
            f"does not match the number of items in 'subpatch_sizes' ({len(cfg.subpatch_sizes)})."
        )
        sys.exit(1)  # Exit with an error

    # Build argument tuples for workers
    worker_args = []
    for tile_path in tile_paths:
        relative_path = tile_path.relative_to(tiles_root)
        label_path = labels_root / relative_path

        # Extract z, x, y from path
        z = int(tile_path.parts[-3])
        x = int(tile_path.parts[-2])
        y = int(tile_path.stem)

        worker_args.append(
            (
                tile_path, label_path, z, x, y,
                images_dir, labels_dir, cfg.subpatch_sizes, subpatch_strides
            )
        )

    # Process tiles in parallel
    records_all: List[dict] = []
    with Pool(processes=args.workers) as pool:
        for recs in tqdm(
                pool.imap_unordered(process_tile, worker_args),
                total=len(worker_args),
                desc="Processing tiles",
        ):
            records_all.extend(recs)

    # Write CSV with rich metadata
    if records_all:
        df = pd.DataFrame(records_all)
        csv_path = target_root / "label_infos.csv"
        df.to_csv(csv_path, index=False)
        print(f"\nSuccessfully wrote metadata to {csv_path}")
    else:
        print("\nNo patches were generated.")

    print(f"Wrote {len(records_all)} patches to {target_root}.")

    # --- FEATURE: Sanity Check ---
    sanity_check(records_all, images_dir, labels_dir)


if __name__ == "__main__":
    os.environ.setdefault("OMP_NUM_THREADS", "1")
    main()
