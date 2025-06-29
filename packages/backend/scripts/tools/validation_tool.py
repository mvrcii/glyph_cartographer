import json
import re
import sys
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, font

import cv2
import numpy as np
import torch
from PIL import Image, ImageTk

# --- Add project root to sys.path to allow importing from `inference` ---
try:
    from inference import _get_model, _locate_tile_path, CTX, TILE_SIZE, MODELS_DIR, TILE_ROOT
except ImportError:
    print("Could not import from 'inference.py'. Make sure the script is in the correct path.")
    script_dir = Path(__file__).resolve().parent
    sys.path.append(str(script_dir.parent))
    try:
        from inference import _get_model, _locate_tile_path, CTX, TILE_SIZE, MODELS_DIR, TILE_ROOT
    except ImportError as e:
        print(f"Fatal: Failed to import inference module after path adjustment. Error: {e}")
        sys.exit(1)


def np_array_to_pil_image(arr, color, opacity):
    """Converts a 2D numpy array (mask/prediction) to a colored, semi-transparent PIL Image."""
    if arr.ndim != 2:
        raise ValueError("Input array must be 2-dimensional")

    height, width = arr.shape
    rgba_image = np.zeros((height, width, 4), dtype=np.uint8)

    mask = arr > 0.01
    rgba_image[mask, 0] = color[0]
    rgba_image[mask, 1] = color[1]
    rgba_image[mask, 2] = color[2]

    alpha_channel = (arr * 255 * opacity).astype(np.uint8)
    rgba_image[:, :, 3] = alpha_channel

    return Image.fromarray(rgba_image, 'RGBA')


class ValidationTool(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Geoglyph Model Validation Tool")
        self.geometry("1150x800")
        self.configure(bg="#2E2E2E")

        # --- Data state ---
        self.model = None
        self.validation_tiles = []
        self.current_tile_index = -1

        # --- PhotoImage references (must be kept to avoid garbage collection) ---
        self.base_photo = None
        self.mask_photo = None
        self.prediction_photo_overlay = None  # For the red overlay
        self.prediction_photo_inspect = None  # For the white-on-black view

        self._create_widgets()
        self._bind_events()

    def _create_widgets(self):
        # --- Define Fonts and Colors ---
        self.header_font = font.Font(family="Helvetica", size=11, weight="bold")
        self.info_font = font.Font(family="Helvetica", size=10)
        self.button_font = font.Font(family="Helvetica", size=10, weight="bold")
        self.bg_color = "#3C3C3C"
        self.fg_color = "#FFFFFF"
        self.label_fg_color = "#E0E0E0"
        self.canvas_bg_color = "gray15"

        # --- Main Layout ---
        main_frame = tk.Frame(self, bg=self.bg_color, padx=10, pady=10)
        main_frame.pack(fill=tk.BOTH, expand=True)

        # --- Top Control Panel ---
        top_frame = tk.Frame(main_frame, bg=self.bg_color)
        top_frame.pack(fill=tk.X, pady=(0, 10))

        self.btn_load_model = tk.Button(top_frame, text="Load Model", font=self.button_font, command=self.load_model,
                                        bg="#4A4A4A", fg=self.fg_color)
        self.btn_load_json = tk.Button(top_frame, text="Load Validation JSON", font=self.button_font,
                                       command=self.load_json, bg="#4A4A4A", fg=self.fg_color)
        self.info_label = tk.Label(top_frame, text="Please load a model and a validation JSON file.", anchor="w",
                                   bg=self.bg_color, fg=self.label_fg_color, font=self.info_font)

        self.btn_load_model.pack(side=tk.LEFT, padx=5)
        self.btn_load_json.pack(side=tk.LEFT, padx=5)
        self.info_label.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=10)

        # --- Display Panel (Side-by-Side) ---
        display_frame = tk.Frame(main_frame, bg=self.bg_color)
        display_frame.pack(fill=tk.BOTH, expand=True)

        left_panel = tk.Frame(display_frame, bg=self.bg_color)
        left_panel.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=(0, 5))
        tk.Label(left_panel, text="Original Image", font=self.header_font, bg=self.bg_color, fg=self.fg_color).pack(
            pady=(0, 5))
        self.canvas_left = tk.Canvas(left_panel, width=TILE_SIZE, height=TILE_SIZE, bg=self.canvas_bg_color,
                                     highlightthickness=0)
        self.canvas_left.pack(fill=tk.BOTH, expand=True)

        right_panel = tk.Frame(display_frame, bg=self.bg_color)
        right_panel.pack(side=tk.RIGHT, fill=tk.BOTH, expand=True, padx=(5, 0))
        tk.Label(right_panel, text="Overlays", font=self.header_font, bg=self.bg_color, fg=self.fg_color).pack(
            pady=(0, 5))
        self.canvas_right = tk.Canvas(right_panel, width=TILE_SIZE, height=TILE_SIZE, bg=self.canvas_bg_color,
                                      highlightthickness=0)
        self.canvas_right.pack(fill=tk.BOTH, expand=True)

        # --- Bottom Control Panel ---
        bottom_frame = tk.Frame(main_frame, bg=self.bg_color, pady=10)
        bottom_frame.pack(fill=tk.X)

        self.btn_prev = tk.Button(bottom_frame, text="Previous (←)", command=self.prev_tile, state=tk.DISABLED,
                                  font=self.button_font, bg="#4A4A4A", fg=self.fg_color)
        self.tile_info_label = tk.Label(bottom_frame, text="Tile: N/A", anchor="center", font=self.header_font,
                                        bg=self.bg_color, fg=self.fg_color, width=60)
        self.btn_next = tk.Button(bottom_frame, text="Next (→)", command=self.next_tile, state=tk.DISABLED,
                                  font=self.button_font, bg="#4A4A4A", fg=self.fg_color)

        self.btn_prev.pack(side=tk.LEFT)
        self.tile_info_label.pack(side=tk.LEFT, fill=tk.X, expand=True)

        toggle_frame = tk.Frame(bottom_frame, bg=self.bg_color)
        self.mask_var = tk.BooleanVar(value=True)
        self.pred_var = tk.BooleanVar(value=True)
        self.inspect_var = tk.BooleanVar(value=False)

        tk.Label(toggle_frame, text=" ", bg="green", relief='sunken', borderwidth=1).pack(side=tk.LEFT, ipadx=5,
                                                                                          padx=(0, 2))
        tk.Checkbutton(toggle_frame, text="Mask (1)", variable=self.mask_var,
                       command=self._update_right_canvas_visibility, font=self.info_font, bg=self.bg_color,
                       fg=self.label_fg_color, selectcolor=self.bg_color, activebackground=self.bg_color,
                       activeforeground=self.fg_color).pack(side=tk.LEFT)

        tk.Label(toggle_frame, text=" ", bg="red", relief='sunken', borderwidth=1).pack(side=tk.LEFT, ipadx=5,
                                                                                        padx=(15, 2))
        tk.Checkbutton(toggle_frame, text="Prediction (2)", variable=self.pred_var,
                       command=self._update_right_canvas_visibility, font=self.info_font, bg=self.bg_color,
                       fg=self.label_fg_color, selectcolor=self.bg_color, activebackground=self.bg_color,
                       activeforeground=self.fg_color).pack(side=tk.LEFT)

        tk.Label(toggle_frame, text=" ", bg="white", relief='sunken', borderwidth=1).pack(side=tk.LEFT, ipadx=5,
                                                                                          padx=(15, 2))
        tk.Checkbutton(toggle_frame, text="Inspect Pred (3)", variable=self.inspect_var,
                       command=self._update_right_canvas_visibility, font=self.info_font, bg=self.bg_color,
                       fg=self.label_fg_color, selectcolor=self.bg_color, activebackground=self.bg_color,
                       activeforeground=self.fg_color).pack(side=tk.LEFT)

        toggle_frame.pack(side=tk.LEFT, padx=30)
        self.btn_next.pack(side=tk.RIGHT)

    def _bind_events(self):
        self.bind('<Right>', lambda event: self.btn_next.invoke())
        self.bind('<Left>', lambda event: self.btn_prev.invoke())
        self.bind('1',
                  lambda event: self.mask_var.set(not self.mask_var.get()) or self._update_right_canvas_visibility())
        self.bind('2',
                  lambda event: self.pred_var.set(not self.pred_var.get()) or self._update_right_canvas_visibility())
        self.bind('3', lambda event: self.inspect_var.set(
            not self.inspect_var.get()) or self._update_right_canvas_visibility())

    def load_model(self):
        initial_dir = Path.cwd() / "checkpoints"
        if not initial_dir.exists(): initial_dir = Path.cwd() / "models"
        if not initial_dir.exists(): initial_dir = Path.cwd()
        filepath = filedialog.askopenfilename(title="Select Model Checkpoint", initialdir=str(initial_dir),
                                              filetypes=[("Checkpoints", "*.ckpt")])
        if filepath:
            try:
                model_name = str(Path(filepath).relative_to(MODELS_DIR))
            except ValueError:
                model_name = Path(filepath).name
            self.info_label.config(text=f"Loading model: {model_name}...")
            self.update_idletasks()
            try:
                self.model = _get_model(model_name)
                self.info_label.config(text=f"✓ Model Loaded: {model_name}")
            except Exception as e:
                self.info_label.config(text=f"Error loading model: {e}")

    def load_json(self):
        filepath = filedialog.askopenfilename(title="Select Validation JSON", filetypes=[("JSON Files", "*.json")])
        if filepath:
            with open(filepath, 'r') as f: self.validation_tiles = json.load(f)
            self.current_tile_index = -1
            self.info_label.config(text=f"Loaded {len(self.validation_tiles)} validation tiles.")
            self.btn_next.config(state=tk.NORMAL)
            self.btn_prev.config(state=tk.NORMAL)
            self.next_tile()

    def next_tile(self):
        if self.current_tile_index < len(self.validation_tiles) - 1:
            self.current_tile_index += 1
            self.display_current_tile()

    def prev_tile(self):
        if self.current_tile_index > 0:
            self.current_tile_index -= 1
            self.display_current_tile()

    def _update_right_canvas_visibility(self):
        """Central function to control visibility of all layers on the right canvas."""
        is_inspecting = self.inspect_var.get()

        if is_inspecting:
            # --- Inspect Mode: White on Black for Prediction ---
            self.canvas_right.config(bg="black")
            self.canvas_right.itemconfigure("base_image", state=tk.HIDDEN)
            self.canvas_right.itemconfigure("mask_layer", state=tk.HIDDEN)
            self.canvas_right.itemconfigure("prediction_overlay_layer", state=tk.HIDDEN)
            self.canvas_right.itemconfigure("prediction_inspect_layer", state=tk.NORMAL)
        else:
            # --- Normal Overlay Mode ---
            self.canvas_right.config(bg=self.canvas_bg_color)
            self.canvas_right.itemconfigure("base_image", state=tk.NORMAL)
            self.canvas_right.itemconfigure("prediction_inspect_layer", state=tk.HIDDEN)
            # Restore visibility based on the other checkboxes
            self.canvas_right.itemconfigure("mask_layer", state=tk.NORMAL if self.mask_var.get() else tk.HIDDEN)
            self.canvas_right.itemconfigure("prediction_overlay_layer",
                                            state=tk.NORMAL if self.pred_var.get() else tk.HIDDEN)

    def run_single_tile_inference(self, img_array: np.ndarray) -> np.ndarray:
        if self.model is None: raise RuntimeError("Model is not loaded.")
        img_tensor = torch.from_numpy(img_array.astype(np.float32) / 255.0).permute(2, 0, 1)
        img_tensor = img_tensor.to(CTX['device']).unsqueeze(0)
        with torch.no_grad():
            logits = self.model(img_tensor)
        return torch.sigmoid(logits).squeeze().cpu().numpy()

    def display_current_tile(self):
        if not (0 <= self.current_tile_index < len(self.validation_tiles)): return

        tile_key = self.validation_tiles[self.current_tile_index]
        self.tile_info_label.config(
            text=f"Tile {self.current_tile_index + 1}/{len(self.validation_tiles)}: {tile_key}")
        self.update_idletasks()

        self.canvas_left.delete("all")
        self.canvas_right.delete("all")

        try:
            # --- MODIFICATION START ---
            # This block is updated to handle both "x,y" format and the original format.

            # Check if the tile_key is in the new "x,y" format.
            # A simple check for a comma and surrounding digits is robust.
            if ',' in tile_key and all(part.strip().isdigit() for part in tile_key.split(',')):
                x_str, y_str = tile_key.split(',')
                x, y = int(x_str.strip()), int(y_str.strip())

                # As requested, build the path to the image tile directly.
                # Assumes zoom level 17 and a .png file extension.
                # The base path TILE_ROOT is imported from the inference module.
                image_path = TILE_ROOT / "17" / str(x) / f"{y}.png"

            # Else, fall back to the original logic for path-like keys.
            else:
                self.tile_info_label.config(
                    text=f"Tile {self.current_tile_index + 1}/{len(self.validation_tiles)}: {Path(tile_key).name}")

                match = re.search(r'_x(\d+)_y(\d+)', tile_key)
                if not match: raise ValueError(f"Could not parse x,y from filename: {tile_key}")
                x, y = map(int, match.groups())

                # Use the original function to locate the tile file (e.g., .npy)
                image_path = _locate_tile_path(x, y)

            # --- MODIFICATION END ---

            if not image_path or not image_path.exists(): raise FileNotFoundError(
                f"Source image not found for tile {x},{y} at '{image_path}'")

            base_img = Image.open(image_path).convert("RGB").resize((TILE_SIZE, TILE_SIZE))
            self.base_photo = ImageTk.PhotoImage(base_img)

            self.canvas_left.create_image(0, 0, anchor="nw", image=self.base_photo)
            self.canvas_right.create_image(0, 0, anchor="nw", image=self.base_photo, tags="base_image")

            mask_path = TILE_ROOT.parent / "labels" / "17" / str(x) / f"{y}.png"
            if mask_path.exists():
                mask_array = cv2.imread(str(mask_path), cv2.IMREAD_GRAYSCALE) / 255.0
                mask_pil = np_array_to_pil_image(mask_array, color=(0, 255, 0), opacity=0.5)
                self.mask_photo = ImageTk.PhotoImage(mask_pil)
                self.canvas_right.create_image(0, 0, anchor="nw", image=self.mask_photo, tags="mask_layer")

            if self.model:
                base_img_np = np.array(base_img)
                prediction_array_low_res = self.run_single_tile_inference(base_img_np)
                prediction_array_full_res = cv2.resize(prediction_array_low_res, (TILE_SIZE, TILE_SIZE),
                                                       interpolation=cv2.INTER_LINEAR)

                pred_pil_overlay = np_array_to_pil_image(prediction_array_full_res, color=(255, 0, 0), opacity=0.6)
                self.prediction_photo_overlay = ImageTk.PhotoImage(pred_pil_overlay)
                self.canvas_right.create_image(0, 0, anchor="nw", image=self.prediction_photo_overlay,
                                               tags="prediction_overlay_layer")

                pred_pil_inspect = np_array_to_pil_image(prediction_array_full_res, color=(255, 255, 255), opacity=1.0)
                self.prediction_photo_inspect = ImageTk.PhotoImage(pred_pil_inspect)
                self.canvas_right.create_image(0, 0, anchor="nw", image=self.prediction_photo_inspect,
                                               tags="prediction_inspect_layer")

            self._update_right_canvas_visibility()

        except Exception as e:
            self.tile_info_label.config(text=f"Error: {e}")
            error_text = f"Error loading tile {tile_key}:\n{e}"
            self.canvas_left.create_text(TILE_SIZE / 2, TILE_SIZE / 2, text=error_text, fill=self.fg_color,
                                         width=TILE_SIZE - 20, justify='center')
            self.canvas_right.create_text(TILE_SIZE / 2, TILE_SIZE / 2, text=error_text, fill=self.fg_color,
                                          width=TILE_SIZE - 20, justify='center')


if __name__ == '__main__':
    app = ValidationTool()
    app.mainloop()
