import asyncio
import base64
import json
import logging
from io import BytesIO
from mimetypes import guess_type
from pathlib import Path

import cv2
import json_repair
import numpy as np
from openai import AsyncOpenAI
from PIL import Image
from skimage.measure import label

from .models import *

logging.basicConfig(level=logging.INFO, format='%(levelname)-8s: %(message)s')


class Tile:
    def __init__(self, x: int, y: int):
        self.x = x
        self.y = y

    def __repr__(self):
        return f"Tile(x={self.x}, y={self.y})"

    def __eq__(self, other):
        return isinstance(other, Tile) and self.x == other.x and self.y == other.y

    def __hash__(self):
        return hash((self.x, self.y))


client = AsyncOpenAI()
semaphore = asyncio.Semaphore(10)

SYSTEM_MESSAGE = {
    "role": "system",
    "content": "You are an expert in detecting ancient Amazonian geoglyphs.",
}

USER_TEMPLATE = (
    "You are an expert in detecting ancient Amazonian geoglyphs. Your task is to determine if the highlighted shape in the prediction image is a geoglyph."
    "\n\n--- ANALYSIS STEPS ---"
    "\n1.  **Analyze the Prediction Mask FIRST:** In isolation, describe the shape highlighted in white. Is it a simple line, or a complex geometric form (e.g., square, circle, rectangle)?"
    "\n2.  **Examine the Satellite Image:** Look at the corresponding area in the satellite image. Can you see faint traces, earthworks, or changes in vegetation that match the shape from the prediction mask?"
    "\n3.  **CRITICAL - Identify Distractors:** Explicitly identify prominent MODERN features like roads, vehicle tracks, or buildings. Acknowledge them as separate from the prediction. The prediction highlights faint, ancient earthworks, NOT modern, high-contrast roads."
    "\n4.  **Final Assessment:** Based on the *shape from the prediction mask* and the *faint corresponding traces in the satellite image*, provide your final JSON judgment. Do not classify the highlighted shape as a 'road' simply because a modern road is also visible elsewhere in the image."
    "\n\nReturn a JSON dict with keys 'description' (your step-by-step reasoning), 'p_glyph' (float, 0-1), and 'structure' (string, e.g., 'road', 'mountain', 'river', or empty if geoglyph)."
)


def pil_image_to_data_url(img: Image, format="PNG") -> str:
    buffered = BytesIO()
    img.save(buffered, format=format)
    b64 = base64.b64encode(buffered.getvalue()).decode("utf-8")
    return f"data:image/{format.lower()};base64,{b64}"


def local_image_to_data_url(path: Path) -> str:
    mime, _ = guess_type(path)
    if not mime: mime = 'application/octet-stream'
    with open(path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("utf-8")
    return f"data:{mime};base64,{b64}"


def decode_prob_png_b64(b64_string: str) -> np.ndarray:
    decoded_bytes = base64.b64decode(b64_string)
    img = Image.open(BytesIO(decoded_bytes)).convert('L')
    return np.array(img) / 255.0


def _locate_tile_path(x: int, y: int, z: int, tile_root: Path) -> Path | None:
    folder = tile_root / str(z) / str(x)
    for ext in (".png", ".jpg", ".jpeg", ".tif", ".tiff"):
        p = folder / f"{y}{ext}"
        if p.exists(): return p
    return None


def _find_connected_tile_groups(tiles: List[TilePrediction]) -> List[List[TilePrediction]]:
    if not tiles: return []
    tile_map = {(t.x, t.y): t for t in tiles}
    tile_set = set(tile_map.keys())
    visited = set()
    groups = []
    for tile_coord in tile_set:
        if tile_coord in visited: continue
        group_tiles = []
        queue = [tile_coord]
        visited.add(tile_coord)
        while queue:
            cx, cy = queue.pop(0)
            group_tiles.append(tile_map[(cx, cy)])
            for dx, dy in [(0, 1), (0, -1), (1, 0), (-1, 0)]:
                neighbor = (cx + dx, cy + dy)
                if neighbor in tile_set and neighbor not in visited:
                    visited.add(neighbor)
                    queue.append(neighbor)
        groups.append(group_tiles)
    return groups


def _find_largest_blob_size(prob_map: np.ndarray, threshold: float) -> int:
    binary_mask = prob_map > threshold
    labeled_mask, num_labels = label(binary_mask, background=0, return_num=True)
    if num_labels == 0: return 0
    blob_sizes = np.bincount(labeled_mask.ravel())
    if len(blob_sizes) > 1:
        return int(np.max(blob_sizes[1:]))
    else:
        return 0


def _create_contextual_masked_image(satellite_img: Image.Image, prob_map: np.ndarray) -> Image.Image:
    sat_cv = cv2.cvtColor(np.array(satellite_img), cv2.COLOR_RGB2BGR)
    darkened_sat = cv2.convertScaleAbs(sat_cv, alpha=0.3, beta=0)
    _, binary_mask = cv2.threshold((prob_map * 255).astype(np.uint8), 80, 255, cv2.THRESH_BINARY)
    kernel_size = int(satellite_img.width / 16);
    if kernel_size % 2 == 0: kernel_size += 1
    kernel = np.ones((kernel_size, kernel_size), np.uint8)
    dilated_mask = cv2.dilate(binary_mask, kernel, iterations=1)
    blur_size = int(kernel_size * 2.5)
    if blur_size % 2 == 0: blur_size += 1
    feathered_mask = cv2.GaussianBlur(dilated_mask, (blur_size, blur_size), 0)
    feathered_mask_3ch = cv2.cvtColor(feathered_mask, cv2.COLOR_GRAY2BGR).astype(float) / 255.0
    blended_image = sat_cv.astype(float) * feathered_mask_3ch + darkened_sat.astype(float) * (1 - feathered_mask_3ch)
    return Image.fromarray(blended_image.astype(np.uint8))


def is_good_result(result):
    valid = False
    if isinstance(result, dict):
        keys = ("p_glyph", "structure", "description")
        if all(k in result for k in keys):
            if isinstance(result["structure"], str) and isinstance(result["description"], str):
                try:
                    float(result["p_glyph"]);
                    valid = True
                except (ValueError, TypeError):
                    pass
    return valid


async def call_openai_api(model_name: str, messages: list, identifier: str) -> dict | None:
    try:
        async with semaphore:
            logging.info(f"Calling OpenAI for identifier: {identifier}")
            resp = await client.chat.completions.create(model=model_name, messages=messages, max_tokens=400)
            raw_content = resp.choices[0].message.content
            try:
                parsed_content = json_repair.loads(raw_content)
                logging.info(f"OpenAI response for {identifier}: {parsed_content}")
                if not is_good_result(parsed_content):
                    logging.warning(f"Malformed result from OpenAI for {identifier}");
                    return None
                return parsed_content
            except Exception as e:
                logging.error(f"OpenAI JSON parsing failed for {identifier}: {e}");
                return None
    except Exception as e:
        logging.error(f"OpenAI API call failed for {identifier}: {e}");
        return None


async def get_oai_predictions(model_predictions: List[TilePrediction], oai_model_name: str, short_model_name: str,
                              tile_root: Path, preds_root: Path, oai_preds_root: Path) -> List[dict]:
    logging.info(f"Starting OAI prediction for {len(model_predictions)} tiles using '{oai_model_name}'...")

    OAI_MEAN_PROB_THRESHOLD = 0.01
    OAI_HIGH_CONF_THRESHOLD = 0.5
    OAI_MIN_BLOB_SIZE_PIXELS = 150
    FULL_CONFIDENCE_THRESHOLD = 0.90
    MIN_CONFIDENCE_THRESHOLD = 0.60
    MAX_IMAGE_SIZE_PX = 2048
    Z_LEVEL, TILE_SIZE = 17, 512

    candidate_tiles = []
    for tile_pred in model_predictions:
        prob_map = decode_prob_png_b64(tile_pred.prob_png_b64)
        mean_prob = np.mean(prob_map)
        if mean_prob > OAI_MEAN_PROB_THRESHOLD:
            largest_blob_size = _find_largest_blob_size(prob_map, threshold=OAI_HIGH_CONF_THRESHOLD)
            if largest_blob_size > OAI_MIN_BLOB_SIZE_PIXELS:
                candidate_tiles.append(tile_pred)
                logging.info(
                    f"Tile ({tile_pred.x},{tile_pred.y}) is a candidate. Mean prob: {mean_prob:.3f}, Largest blob: {largest_blob_size}px.")

    logging.info(f"Found {len(candidate_tiles)} candidates using blob detection.")
    tile_groups = _find_connected_tile_groups(candidate_tiles)
    logging.info(f"Grouped candidates into {len(tile_groups)} connected groups.")

    tasks = []
    group_mapping = {}
    for i, group in enumerate(tile_groups):
        if not group: continue

        min_x, max_x = min(t.x for t in group), max(t.x for t in group)
        min_y, max_y = min(t.y for t in group), max(t.y for t in group)
        canvas_width, canvas_height = (max_x - min_x + 1) * TILE_SIZE, (max_y - min_y + 1) * TILE_SIZE
        stitched_satellite, stitched_prediction = Image.new('RGB', (canvas_width, canvas_height)), Image.new('L',
                                                                                                             (canvas_width,
                                                                                                              canvas_height))

        for tile_pred in group:
            rel_x, rel_y = tile_pred.x - min_x, tile_pred.y - min_y
            sat_path = _locate_tile_path(tile_pred.x, tile_pred.y, Z_LEVEL, tile_root)
            if sat_path and sat_path.exists():
                with Image.open(sat_path) as img: stitched_satellite.paste(img.resize((TILE_SIZE, TILE_SIZE)),
                                                                           (rel_x * TILE_SIZE, rel_y * TILE_SIZE))
            pred_path = preds_root / short_model_name / str(Z_LEVEL) / str(tile_pred.x) / f"{tile_pred.y}.png"
            if pred_path.exists():
                with Image.open(pred_path) as img: stitched_prediction.paste(img.resize((TILE_SIZE, TILE_SIZE)),
                                                                             (rel_x * TILE_SIZE, rel_y * TILE_SIZE))

        stitched_prob_map = np.array(stitched_prediction).astype(float) / 255.0
        contextual_satellite_image = _create_contextual_masked_image(stitched_satellite, stitched_prob_map)

        for img in [contextual_satellite_image, stitched_prediction]:
            if img.width > MAX_IMAGE_SIZE_PX or img.height > MAX_IMAGE_SIZE_PX:
                logging.info(f"Resizing image from {img.size} to fit within {MAX_IMAGE_SIZE_PX}px.")
                img.thumbnail((MAX_IMAGE_SIZE_PX, MAX_IMAGE_SIZE_PX), Image.Resampling.LANCZOS)

        debug_image_dir = oai_preds_root / "debug_stitched_images"
        debug_image_dir.mkdir(parents=True, exist_ok=True)
        group_filename_base = f"group_{i}_coords_{min_x}_{min_y}"

        contextual_save_path = debug_image_dir / f"{group_filename_base}_contextual.png"
        contextual_satellite_image.save(contextual_save_path)
        logging.info(f"Saved debug contextual image to {contextual_save_path}")

        prediction_save_path = debug_image_dir / f"{group_filename_base}_prediction.png"
        stitched_prediction.save(prediction_save_path)
        logging.info(f"Saved debug prediction image to {prediction_save_path}")

        sat_url = pil_image_to_data_url(contextual_satellite_image)
        pred_url = pil_image_to_data_url(stitched_prediction)

        messages = [{"role": "system", "content": SYSTEM_MESSAGE["content"]}, {"role": "user", "content": [
            {"type": "text", "text": USER_TEMPLATE},
            {"type": "image_url", "image_url": {"url": sat_url, "detail": "auto"}},
            {"type": "image_url", "image_url": {"url": pred_url, "detail": "auto"}}]}]
        group_identifier = f"group_{i}_coords_{min_x}_{min_y}"

        task = call_openai_api(oai_model_name, messages, group_identifier)
        tasks.append(task)
        group_mapping[i] = group

    if not tasks: logging.info("No OAI tasks to perform."); return []

    logging.info(f"Executing {len(tasks)} OAI tasks concurrently...")
    results = await asyncio.gather(*tasks, return_exceptions=True)

    oai_predictions_list = []
    for i, result in enumerate(results):
        if isinstance(result, Exception): logging.error(f"Task {i} failed with exception: {result}"); continue
        if result is None: continue

        group = group_mapping.get(i)
        if not group: continue

        p_glyph_group = float(result.get("p_glyph"))
        description = result.get("description", "No description provided.").strip()
        structure = result.get("structure", "").strip()

        for tile_pred in group:
            prob_map = decode_prob_png_b64(tile_pred.prob_png_b64)
            local_certainty = np.max(prob_map)
            certainty_weight = np.interp(local_certainty, [MIN_CONFIDENCE_THRESHOLD, FULL_CONFIDENCE_THRESHOLD],
                                         [0.3, 1.0])
            final_prob = p_glyph_group * certainty_weight
            oai_predictions_list.append(
                OAITilePrediction(x=tile_pred.x, y=tile_pred.y, prob=final_prob, label=structure,
                                  description=f"[Group Certainty: {p_glyph_group:.2f} | Local Weight: {certainty_weight:.2f}] {description}"))

    logging.info(f"Finished OAI processing. Generated {len(oai_predictions_list)} OAITilePrediction objects.")

    for pred in oai_predictions_list:
        output_dir = oai_preds_root / short_model_name / "17" / str(pred.x)
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / f"{pred.y}.json"
        with open(output_path, "w") as f:
            json.dump({"prob": pred.prob, "label": pred.label, "description": pred.description}, f)

    return [pred.model_dump() for pred in oai_predictions_list]
