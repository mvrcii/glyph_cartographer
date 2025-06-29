#!/usr/bin/env python3
"""
inspect_patches_interactive.py
------------------------------------------------
Click the "Next ⏭" button to display the next N (default 16) patches.

Tips
----
• Close the window to quit.
• Works with any multiscale dataset produced by create_dataset.py.
"""

import argparse
import random
from pathlib import Path

import cv2
import matplotlib
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.widgets import Button


# ───────────────────────── helpers ───────────────────────── #

def unpack_label(label_path: Path, label_size: int) -> np.ndarray:
    flat = np.unpackbits(np.load(label_path))[: label_size * label_size]
    return flat.reshape(label_size, label_size)


def upscale(mask: np.ndarray, size: int) -> np.ndarray:
    return cv2.resize(mask.astype(np.uint8) * 255,
                      (size, size),
                      interpolation=cv2.INTER_NEAREST).astype(bool)


def collect_pairs(root: Path, patch_size: int):
    images_dir, labels_dir = root / "images", root / "labels"
    suffix = f"_s{patch_size}.npy"
    pics = sorted(p for p in images_dir.glob(f"*{suffix}") if p.is_file())
    return [(p, labels_dir / p.name) for p in pics if (labels_dir / p.name).exists()]


# ───────────────────────── interactive viewer ───────────────────────── #

class PatchViewer:
    def __init__(self, pairs, patch_size, n=16):
        self.pairs = pairs
        random.shuffle(self.pairs)  # random order
        self.ptr = 0
        self.n = n
        self.ps = patch_size
        self.ls = patch_size // 4

        # grid layout
        self.cols = int(np.ceil(np.sqrt(self.n)))
        self.rows = int(np.ceil(self.n / self.cols))
        self.fig, self.axes = plt.subplots(
            self.rows, self.cols,
            figsize=(2.0 * self.cols, 2.0 * self.rows)
        )
        self.axes = self.axes.flatten()

        # add Next button
        ax_btn = self.fig.add_axes([0.85, 0.01, 0.12, 0.05])
        self.btn = Button(ax_btn, 'Next')
        self.btn.on_clicked(self.show_next)

        # first draw
        self.show_next(None)

    # ------------------------------------------------------------------ #
    def draw_patch(self, ax, img_path, lbl_path):
        rgb = np.transpose(np.load(img_path), (1, 2, 0)).astype(np.uint8)
        mask = upscale(unpack_label(lbl_path, self.ls), self.ps)

        overlay = np.zeros((*mask.shape, 4), float)
        overlay[..., 0] = 1.0  # red
        overlay[..., 3] = mask * 0.55

        z, x, y = [part[1:] for part in img_path.stem.split('_')[:3]]
        ax.imshow(rgb)
        ax.imshow(overlay)
        ax.set_title(f"{z}/{x}/{y}", fontsize=6, color="white")
        ax.axis('off')

    # ------------------------------------------------------------------ #
    def show_next(self, _event):
        for ax in self.axes:
            ax.clear();
            ax.axis('off')

        end = min(self.ptr + self.n, len(self.pairs))
        for ax, (img_p, lbl_p) in zip(self.axes, self.pairs[self.ptr:end]):
            self.draw_patch(ax, img_p, lbl_p)

        self.ptr = end if end < len(self.pairs) else 0  # wrap-around
        self.fig.canvas.draw_idle()


# ───────────────────────── CLI / main ───────────────────────── #

def parse_args():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="data/datasets/multiscale")
    ap.add_argument("--patch-size", type=int, default=256)
    ap.add_argument("-n", "--num", type=int, default=16, help="patches per page")
    return ap.parse_args()


if __name__ == "__main__":
    args = parse_args()
    pairs = collect_pairs(Path(args.root), args.patch_size)
    if not pairs:
        raise SystemExit("No matching patches found!")

    matplotlib.rcParams["figure.facecolor"] = "black"
    viewer = PatchViewer(pairs, args.patch_size, args.num)
    plt.show()
