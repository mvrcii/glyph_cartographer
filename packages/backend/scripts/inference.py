"""
FastAPI-based inference service with model selection, advanced sliding-window, TTA, and chunking.
"""

from __future__ import annotations
from tqdm import tqdm

import base64
import platform
import logging
import os
import time
from contextlib import asynccontextmanager
from io import BytesIO
from pathlib import Path
from typing import Generator

import cv2
import numpy as np
import torch
import uvicorn
from PIL import Image
from dotenv import load_dotenv
from fastapi import FastAPI, Response

from glyph.model.lightning_module import SF_Module
from glyph.utility.configs import Config

from .models import *

# --- Configuration ---
logging.basicConfig(level=logging.INFO, format='%(levelname)-8s: %(message)s')

# This file is at: /packages/backend/scripts/inference.py
# The project root is 4 levels up. This is robust and independent of the current working directory.
ROOT_DIR = Path(__file__).resolve().parents[3]

dotenv_path = ROOT_DIR / "packages" / "backend" / ".env"
if dotenv_path.exists():
    load_dotenv(dotenv_path=dotenv_path)
    logging.info(f"Loaded environment variables from {dotenv_path}")
else:
    logging.warning(f".env file not found at {dotenv_path}, using default paths.")

from backend.scripts.oai_prediction import get_oai_predictions, OAITilePrediction

torch.set_float32_matmul_precision('high')

# Resolve all paths by joining the ROOT_DIR with the relative paths from .env
# to guarantee every path variable is an absolute path.
TILE_ROOT = ROOT_DIR / os.getenv("TILE_DATA_PATH", "data/tiles")
PREDS_ROOT = ROOT_DIR / os.getenv("PREDS_PATH", "data/preds")
OAI_PREDS_ROOT = ROOT_DIR / os.getenv("OAI_PREDS_PATH", "data/oai_preds")
MODELS_DIR = ROOT_DIR / os.getenv("MODELS_DIR", "checkpoints")

logging.info(f"Project ROOT_DIR resolved to: {ROOT_DIR}")
logging.info(f"Models will be loaded from: {MODELS_DIR}")
logging.info(f"Predictions will be saved to: {PREDS_ROOT}")
logging.info(f"OAI Predictions will be saved to: {OAI_PREDS_ROOT}")
logging.info(f"Source tiles will be read from: {TILE_ROOT}")

API_PORT = int(os.getenv("INFERENCE_PORT", 8001))
TILE_SIZE = 512
MODEL_SCALE_FACTOR = 4
INFERENCE_PATCH_SIZE = int(os.getenv("INFERENCE_PATCH_SIZE", 512))
INFERENCE_STRIDE = int(os.getenv("INFERENCE_STRIDE", 256))
USE_TTA = os.getenv("USE_TTA", "false").lower() in ("true", "1", "t")  # Corrected boolean parsing
MAX_GROUP_TILE_COUNT = int(os.getenv("MAX_GROUP_TILE_COUNT", 900))
CHUNK_SIZE_IN_TILES = int(os.getenv("CHUNK_SIZE_IN_TILES", 20))


# --- Globals & Model Loading ---
CTX = {
    "models_cache": {},
    "device": torch.device("cuda" if torch.cuda.is_available() else "cpu")
}


def get_short_model_name(full_model_path: str) -> str:
    """
    Extracts a short, human-readable name from a full model checkpoint path.
    The input path is expected to be like: 'RUN_NAME/CHECKPOINT.ckpt'
    E.g., "dazzling-plasma-63-sf-b5.../best.ckpt" -> "dazzling-plasma-63"
    """
    if not full_model_path:
        return "unknown_model"

    path_str = full_model_path.replace('\\', '/')
    run_name = path_str.split('/')[0]
    short_name = "-".join(run_name.split('-')[:3])

    return short_name


def _get_model(model_name: str):
    """
    Loads a model into a cache on demand (lazy loading).
    Returns the model from cache if already loaded.
    """
    if model_name not in CTX["models_cache"]:
        logging.info(f"Model '{model_name}' not in cache. Loading...")
        t0 = time.perf_counter()

        model_path = MODELS_DIR / model_name
        if not model_path.exists():
            logging.error(f"FATAL: Model checkpoint not found at {model_path}")
            raise FileNotFoundError(f"Model checkpoint '{model_name}' not found.")

        ckpt = torch.load(model_path, map_location="cpu")
        cfg = Config.load_from_dict(ckpt.get("hyper_parameters", {}))

        arch_class = SF_Module
        if getattr(cfg, "architecture", None) == "sf":
            arch_class = SF_Module

        model = arch_class.load_from_checkpoint(model_path, strict=True, cfg=cfg)
        model.to(CTX['device']).eval()
        if platform.system() == "Windows":
            print("skipping torch compile")
        else:
            print("compiling")
            model = torch.compile(model)

        CTX["models_cache"][model_name] = model
        logging.info(f"✓ Model '{model_name}' loaded and cached in {time.perf_counter() - t0:.1f}s")

    return CTX["models_cache"][model_name]


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Handles application startup and shutdown events."""
    logging.info("Inference service started. Models will be loaded on demand.")
    yield
    CTX.clear()
    logging.info("Inference service shut down.")


app = FastAPI(lifespan=lifespan)


# --- API Endpoints ---
@app.get("/models", response_model=List[str])
async def list_available_models():
    """Scans the models directory recursively and returns a list of available .ckpt files."""
    if not MODELS_DIR.is_dir():
        logging.error(f"MODELS_DIR not found at {MODELS_DIR}")
        return []
    models = sorted([str(f.relative_to(MODELS_DIR)) for f in MODELS_DIR.glob("**/*.ckpt")])
    return models


@app.post("/inference", response_model=InferenceResponse)
async def http_run_inference(request: InferenceRequest):
    """Main endpoint to handle batch inference requests."""
    t_start = time.perf_counter()
    logging.info(f"Received inference request for {len(request.tiles)} tiles using model '{request.model_name}'.")

    try:
        model = _get_model(request.model_name)
    except FileNotFoundError as e:
        return Response(content=str(e), status_code=404)

    patch_size = request.patch_size if request.patch_size is not None else INFERENCE_PATCH_SIZE
    stride = request.stride if request.stride is not None else INFERENCE_STRIDE
    use_tta = request.use_tta if request.use_tta is not None else USE_TTA

    logging.info(f"Using patch_size={patch_size}, stride={stride} and use_tta={use_tta}")

    short_model_name = get_short_model_name(request.model_name)
    logging.info(f"Derived short name for storage: '{short_model_name}'")

    initial_groups = find_connected_tile_groups(request.tiles)

    all_processing_chunks = []
    for group in initial_groups:
        if len(group) > MAX_GROUP_TILE_COUNT:
            logging.info(
                f"Group with {len(group)} tiles is too large. Chunking into {CHUNK_SIZE_IN_TILES}x{CHUNK_SIZE_IN_TILES} grids...")
            chunks = _split_large_group_into_chunks(group, CHUNK_SIZE_IN_TILES)
            all_processing_chunks.extend(chunks)
        else:
            all_processing_chunks.append(group)

    logging.info(
        f"Found {len(initial_groups)} initial groups, resulting in {len(all_processing_chunks)} processing chunks.")

    all_predictions = []
    for i, chunk in enumerate(all_processing_chunks):
        logging.info(f"Processing chunk {i + 1}/{len(all_processing_chunks)} with {len(chunk)} tiles.")
        group_predictions = process_tile_group(chunk, model, patch_size, stride, use_tta, short_model_name)
        all_predictions.extend(group_predictions)

    elapsed = time.perf_counter() - t_start
    logging.info(f"Finished processing all chunks in {elapsed:.2f}s.")

    oai_predictions = []
    if request.use_oai:
        # Before generating new OAI predictions, delete the old ones for the requested tiles.
        # This prevents stale predictions from persisting if a tile is no longer a candidate.
        logging.info(f"Deleting existing OAI predictions for {len(request.tiles)} tiles to ensure freshness.")
        for tile in request.tiles:
            old_pred_path = OAI_PREDS_ROOT / short_model_name / "17" / str(tile.x) / f"{tile.y}.json"
            if old_pred_path.exists():
                try:
                    old_pred_path.unlink()
                except OSError as e:
                    logging.warning(f"Could not delete old OAI prediction {old_pred_path}: {e}")

        oai_predictions = await get_oai_predictions(
            model_predictions=all_predictions,
            oai_model_name=request.oai_model_name,
            short_model_name=short_model_name,
            tile_root=TILE_ROOT,
            preds_root=PREDS_ROOT,
            oai_preds_root=OAI_PREDS_ROOT
        )

    return InferenceResponse(
        message=f"Processed {len(all_predictions)} tiles in {elapsed:.2f}s.",
        predictions=all_predictions,
        oai_predictions=oai_predictions
    )


# --- Helper Functions ---
def _generate_gaussian_kernel(size: int, sigma: float) -> np.ndarray:
    ax = np.arange(-size // 2 + 1.0, size // 2 + 1.0)
    xx, yy = np.meshgrid(ax, ax)
    kernel = np.exp(-(xx ** 2 + yy ** 2) / (2.0 * sigma ** 2))
    return kernel / np.sum(kernel)


GAUSSIAN_KERNEL = _generate_gaussian_kernel(INFERENCE_PATCH_SIZE, sigma=170)


def _locate_tile_path(x: int, y: int, z: int = 17) -> Path | None:
    folder = TILE_ROOT / str(z) / str(x)
    for ext in (".png", ".jpg", ".jpeg", ".tif", ".tiff"):
        p = folder / f"{y}{ext}"
        if p.exists():
            return p
    return None


def _encode_png_base64(arr: np.ndarray) -> str:
    img_arr = (arr * 255).astype(np.uint8)
    img = Image.fromarray(img_arr, 'L')
    buf = BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


# --- Inference & Processing Logic ---
def _run_sliding_window_inference(
        canvas: np.ndarray,
        model,
        patch_size: int,
        stride: int,
        use_tta: bool,
        batch_size: int = 8
) -> np.ndarray:
    """
    Sliding-window inference with optional test-time augmentation (TTA), Gaussian
    weighting and **batched** forward passes.

    Args
    ----
    canvas      :  H×W×C image in uint8/range 0-255.
    model       :  Callable → tensor with shape  (B, h_out, w_out)
                   where h_out = patch_size // MODEL_SCALE_FACTOR.
    patch_size  :  Square side length fed to the net (in input pixels).
    stride      :  Step in input pixels between successive patch *origins*.
    use_tta     :  If True, horizontal-flip TTA is averaged in.
    batch_size  :  Maximum number of patches per forward pass.
    """
    device = CTX["device"]
    canvas_h, canvas_w, _ = canvas.shape
    out_h, out_w = canvas_h // MODEL_SCALE_FACTOR, canvas_w // MODEL_SCALE_FACTOR

    # Aggregators (running sum and weights)
    pred_sum = np.zeros((out_h, out_w), dtype=np.float32)
    norm_sum = np.zeros_like(pred_sum)

    # Gaussian kernel (2-D, dtype float32 in [0,1])
    kernel = (GAUSSIAN_KERNEL if patch_size == INFERENCE_PATCH_SIZE
              else _generate_gaussian_kernel(patch_size, sigma=patch_size / 6))
    out_ps = patch_size // MODEL_SCALE_FACTOR
    kernel_resized = cv2.resize(kernel, (out_ps, out_ps))

    img_tensor = (torch.from_numpy(canvas.astype(np.float32) / 255.)
                  .permute(2, 0, 1)  # C,H,W
                  .to(device))

    # Enumerate all patch start-positions once so we can batch them
    positions = [(y, x)
                 for y in range(0, canvas_h, stride)
                 for x in range(0, canvas_w, stride)]

    # Walk through positions, assembling mini-batches
    batch, meta = [], []  # meta keeps (output_y, output_x, patch_h, patch_w)
    for y, x in tqdm(positions, "Inference", leave=False):
        y_end, x_end = min(y + patch_size, canvas_h), min(x + patch_size, canvas_w)
        patch = img_tensor[:, y:y_end, x:x_end].unsqueeze(0)  # 1,C,h,w

        # Zero-pad to square patch_size×patch_size if at border
        pad_h, pad_w = patch_size - (y_end - y), patch_size - (x_end - x)
        if pad_h or pad_w:
            patch = torch.nn.functional.pad(patch, [0, pad_w, 0, pad_h], mode="constant", value=0)

        batch.append(patch)
        meta.append((y // MODEL_SCALE_FACTOR,
                     x // MODEL_SCALE_FACTOR,
                     (y_end - y),
                     (x_end - x)))

        # Run model if batch is full or we just queued the last patch
        if len(batch) == batch_size or (y, x) == positions[-1]:
            batch_tensor = torch.cat(batch, dim=0)  # B,C,patch_size,patch_size

            with torch.no_grad():
                if use_tta:
                    flipped = torch.flip(batch_tensor, dims=[-1])  # flip horizontally (width dim)
                    logits_f = model(flipped)
                    logits_f = torch.flip(logits_f, dims=[-1])  # de-augment
                    logits_orig = model(batch_tensor)
                    logits_3d = (logits_orig + logits_f) / 2.0
                else:
                    logits_3d = model(batch_tensor)

            # Scatter every sample of the mini-batch into the big canvas
            for i, (o_y, o_x, ph, pw) in enumerate(meta):
                logits = logits_3d[i]
                if logits.ndim == 3:  # (C,h,w) → assume C==1
                    logits = logits.squeeze(0)

                # Crop away padding in network space
                oh, ow = ph // MODEL_SCALE_FACTOR, pw // MODEL_SCALE_FACTOR
                logits = logits[:oh, :ow].cpu().numpy()

                pred_sum[o_y:o_y + oh, o_x:o_x + ow] += logits * kernel_resized[:oh, :ow]
                norm_sum[o_y:o_y + oh, o_x:o_x + ow] += kernel_resized[:oh, :ow]

            batch, meta = [], []

    return pred_sum / (norm_sum + 1e-8)


def find_connected_tile_groups(tiles: List[Tile]) -> List[List[Tile]]:
    """Groups adjacent tiles using a Breadth-First Search (BFS) algorithm."""
    if not tiles:
        return []
    tile_set = {(t.x, t.y) for t in tiles}
    visited = set()
    groups = []
    for tile in tiles:
        coord = (tile.x, tile.y)
        if coord in visited:
            continue
        group = []
        queue = [coord]
        visited.add(coord)
        while queue:
            cx, cy = queue.pop(0)
            group.append(Tile(x=cx, y=cy))
            for dx, dy in [(0, 1), (0, -1), (1, 0), (-1, 0)]:
                neighbor = (cx + dx, cy + dy)
                if neighbor in tile_set and neighbor not in visited:
                    visited.add(neighbor)
                    queue.append(neighbor)
        groups.append(group)
    return groups


def _split_large_group_into_chunks(group: List[Tile], chunk_size: int) -> Generator[List[Tile], None, None]:
    """Breaks a single large list of connected tiles into smaller chunks."""
    min_x, max_x = min(t.x for t in group), max(t.x for t in group)
    min_y, max_y = min(t.y for t in group), max(t.y for t in group)
    group_coords = {(t.x, t.y) for t in group}

    for y_start in range(min_y, max_y + 1, chunk_size):
        for x_start in range(min_x, max_x + 1, chunk_size):
            chunk_tiles = []
            y_end, x_end = y_start + chunk_size, x_start + chunk_size
            for y in range(y_start, y_end):
                for x in range(x_start, x_end):
                    if (x, y) in group_coords:
                        chunk_tiles.append(Tile(x=x, y=y))
            if chunk_tiles:
                yield chunk_tiles


def process_tile_group(group: List[Tile], model, patch_size: int, stride: int, use_tta: bool, short_model_name: str) -> \
        List[TilePrediction]:
    """Stitches a group of tiles, runs inference, saves results, and destitches."""
    min_x, max_x = min(t.x for t in group), max(t.x for t in group)
    min_y, max_y = min(t.y for t in group), max(t.y for t in group)

    patch_width_tiles, patch_height_tiles = max_x - min_x + 1, max_y - min_y + 1
    canvas = np.zeros((patch_height_tiles * TILE_SIZE, patch_width_tiles * TILE_SIZE, 3), dtype=np.uint8)

    for tile in group:
        tile_path = _locate_tile_path(tile.x, tile.y)
        if tile_path:
            try:
                img_arr = np.array(Image.open(tile_path).convert("RGB").resize((TILE_SIZE, TILE_SIZE)))
                rel_x, rel_y = tile.x - min_x, tile.y - min_y
                canvas[rel_y * TILE_SIZE: (rel_y + 1) * TILE_SIZE, rel_x * TILE_SIZE: (rel_x + 1) * TILE_SIZE,
                :] = img_arr
            except Exception as e:
                logging.warning(f"Could not load or place tile {tile_path}: {e}")

    prediction_patch_low_res = _run_sliding_window_inference(canvas, model, patch_size, stride, use_tta)

    predictions = []
    output_tile_size = TILE_SIZE // MODEL_SCALE_FACTOR

    for tile in group:
        rel_x, rel_y = tile.x - min_x, tile.y - min_y
        low_res_slice = prediction_patch_low_res[
                        rel_y * output_tile_size: (rel_y + 1) * output_tile_size,
                        rel_x * output_tile_size: (rel_x + 1) * output_tile_size
                        ]

        low_res_img = Image.fromarray(low_res_slice)
        resized_img = low_res_img.resize((TILE_SIZE, TILE_SIZE), resample=Image.Resampling.BILINEAR)
        logits_slice_full_res = np.array(resized_img)

        prob_slice_full_res = 1.0 / (1.0 + np.exp(-logits_slice_full_res))

        try:
            pred_img = Image.fromarray((prob_slice_full_res * 255).astype(np.uint8), 'L')
            output_dir = PREDS_ROOT / short_model_name / "17" / str(tile.x)
            output_dir.mkdir(parents=True, exist_ok=True)
            output_path = output_dir / f"{tile.y}.png"
            pred_img.save(output_path, "PNG")
        except Exception as e:
            logging.error(f"Failed to save prediction tile for {tile.x},{tile.y}: {e}")

        predictions.append(
            TilePrediction(
                x=tile.x,
                y=tile.y,
                prob_png_b64=_encode_png_base64(prob_slice_full_res),
            )
        )
    return predictions


if __name__ == "__main__":
    PREDS_ROOT.mkdir(exist_ok=True)
    uvicorn.run("packages.backend.scripts.inference:app", host="0.0.0.0", port=API_PORT, reload=True)