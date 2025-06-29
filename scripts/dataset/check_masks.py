#!/usr/bin/env python3
"""
check_masks.py  –  verify that at least some labels are non-empty
"""
from pathlib import Path, PurePath
import numpy as np
import random, argparse

def bits_nonzero(path: Path, size: int) -> int:
    lbl = np.load(path)
    flat = np.unpackbits(lbl)[: size*size]
    return flat.sum()

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="data/datasets/multiscale", type=str)
    ap.add_argument("--patch-size", default=256, type=int)
    ap.add_argument("-n", "--num", default=20, type=int)
    args = ap.parse_args()

    label_dir = Path(args.root) / "labels"
    suffix = f"_s{args.patch_size}.npy"
    files = list(label_dir.glob(f"*{suffix}"))
    sample = random.sample(files, min(args.num, len(files)))

    nonzeros = [bits_nonzero(p, args.patch_size // 4) for p in sample]
    for p, n in zip(sample, nonzeros):
        print(f"{p.name:50s} {n} positive bits")
    nz = sum(n > 0 for n in nonzeros)
    print(f"\n{nz}/{len(nonzeros)} have at least one positive pixel.")
