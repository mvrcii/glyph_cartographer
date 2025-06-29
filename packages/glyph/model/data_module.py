# --- START OF FILE data_module.py ---

import os
import re
import json
from pathlib import Path

import albumentations as A
import pandas as pd
from lightning.pytorch import LightningDataModule
from sklearn.model_selection import train_test_split
from torch.utils.data import DataLoader

from glyph.model.dataset import SF_Dataset
from glyph.utility.configs import Config


class SF_DataModule(LightningDataModule):
    def __init__(self, cfg, model_run_dir = None, cherry_val_json_path: str | None = None):
        super().__init__()
        self.cfg = cfg
        self.t_img_paths = None
        self.t_label_paths = None
        self.v_img_paths = None
        self.v_label_paths = None
        self.model_run_dir = model_run_dir
        self.cherry_val_json_path = cherry_val_json_path
        self.resolved_cherry_val_json_path = None # To store the path actually used
        self.generate_dataset(cfg=cfg)

    def generate_dataset(self, cfg: Config):
        # ... (previous code for generate_file_path, df loading, scale_suffix, tile_id) ...
        def generate_file_path(row, filename_column='filename'):
            return os.path.join('images', row[filename_column])

        csv_path = os.path.join(cfg.dataset_target_dir, 'label_infos.csv')
        try:
            df = pd.read_csv(csv_path)
        except Exception as e:
            raise RuntimeError(f"Failed to load dataset infos: {e}")

        scale_suffix = f"_s{cfg.patch_size}.npy"
        df = df[df["filename"].str.endswith(scale_suffix)]
        if df.empty:
            raise RuntimeError(f"No patches with suffix {scale_suffix} found – "
                               f"did you set cfg.patch_size correctly?")

        df['tile_id'] = df['zoom'].astype(str) + '_' + df['tile_x'].astype(str) + '_' + df['tile_y'].astype(str)
        unique_tiles = df['tile_id'].unique()
        random_state = None if cfg.seed == -1 else cfg.seed

        # This was in your original code, implying cherry_validation is generally preferred/attempted.
        # If train.py needs to sometimes NOT do cherry_validation, this should be configurable.
        cherry_validation = True
        if cherry_validation:
            print("Attempting to use a cherry-picked validation set.")

            _path_to_load_val_json = self.cherry_val_json_path
            if _path_to_load_val_json is None:
                current_file_path_obj = Path(__file__).resolve()
                parent_dir_of_datamodule = current_file_path_obj.parent
                _path_to_load_val_json = os.path.join(parent_dir_of_datamodule, "validation_files.json")
                print(f"No specific cherry_val_json_path provided, defaulting to: {_path_to_load_val_json}")

            self.resolved_cherry_val_json_path = _path_to_load_val_json # Store the resolved path

            if not Path(self.resolved_cherry_val_json_path).exists():
                raise FileNotFoundError(
                    f"Cherry validation file list not found: {self.resolved_cherry_val_json_path}. "
                    "Ensure this file exists."
                )

            with open(self.resolved_cherry_val_json_path) as f:
                val_npy_names_for_cherry = json.load(f)
            print(f"Loaded {len(val_npy_names_for_cherry)} names from {self.resolved_cherry_val_json_path} for cherry-picking.")

            _id_re = re.compile(r"z(?P<z>\d+)_x(?P<x>\d+)_y(?P<y>\d+)")

            def fname_to_tile_id(fname: str) -> str | None:
                m = _id_re.search(fname)
                if m:
                    return f"{m['z']}_{m['x']}_{m['y']}"
                return None

            val_tile_ids_set = {fname_to_tile_id(f) for f in val_npy_names_for_cherry}
            val_tile_ids_set.discard(None)
            val_tile_ids_set &= set(unique_tiles) # Keep only existing unique tiles

            if not val_tile_ids_set:
                print(f"Warning: No valid tile IDs derived from {self.resolved_cherry_val_json_path} were found in the dataset's unique tiles. "
                      "Validation set will be empty if no other split method is used.")

            train_tile_ids = set(unique_tiles) - val_tile_ids_set
            val_tile_ids = sorted(list(val_tile_ids_set)) # Use the filtered set
            train_tile_ids = sorted(list(train_tile_ids))
        else:
            # Standard split if not cherry-picking (or if cherry-picking failed to find tiles)
            print("Using standard train_test_split for validation set.")
            self.resolved_cherry_val_json_path = None # Indicate no cherry-picked file was used
            train_tile_ids, val_tile_ids = train_test_split(
                unique_tiles,
                test_size=cfg.val_frac,
                random_state=random_state
            )

        # ... (rest of the generate_dataset method from the previous answer, no changes needed there) ...
        print(f"Splitting {len(unique_tiles)} unique tiles into {len(train_tile_ids)} for training and {len(val_tile_ids)} for validation.")

        train_df = df[df['tile_id'].isin(train_tile_ids)].copy()
        valid_df = df[df['tile_id'].isin(val_tile_ids)].copy()

        if len(train_df) > 0 :
            print("\nTraining set composition (before balancing):")
            count_zero_train = (train_df['glyph_p'] == 0).sum()
            count_greater_than_zero_train = (train_df['glyph_p'] > 0).sum()
            print(f"  - Patches without glyphs: {count_zero_train}")
            print(f"  - Patches with glyphs:    {count_greater_than_zero_train}")

            df_glyph = train_df[train_df['glyph_p'] >= cfg.glyph_ratio]
            no_glyph_sample_count = int(len(df_glyph) * cfg.no_glyph_sample_percentage)
            actual_no_glyph_to_sample = min(no_glyph_sample_count, (train_df['glyph_p'] == 0).sum())
            if (train_df['glyph_p'] == 0).sum() > 0 and actual_no_glyph_to_sample > 0 :
                df_no_glyph = train_df[train_df['glyph_p'] == 0].sample(n=actual_no_glyph_to_sample,
                                                                        random_state=random_state)
                train_df = pd.concat([df_glyph, df_no_glyph]).sample(frac=1, random_state=random_state).reset_index(drop=True)
            else:
                train_df = df_glyph.sample(frac=1, random_state=random_state).reset_index(drop=True)


            print("\nTraining set composition (after balancing):")
            count_zero_final = (train_df['glyph_p'] == 0).sum()
            count_glyph_final = (train_df['glyph_p'] >= cfg.glyph_ratio).sum()
            print(f"  - Patches without glyphs: {count_zero_final}")
            print(f"  - Patches with glyphs (glyph_p >= {cfg.glyph_ratio}): {count_glyph_final}")
            print(f"  = Total selected training samples: {len(train_df)}")
        else:
            print("No training samples selected or available for balancing.")


        train_df['file_path'] = train_df.apply(generate_file_path, axis=1)
        valid_df['file_path'] = valid_df.apply(generate_file_path, axis=1)

        if len(valid_df) == 0:
            # This is a critical error if cherry_validation was True and resolved_cherry_val_json_path was set
            if cherry_validation and self.resolved_cherry_val_json_path:
                raise ValueError(f"No validation samples found after splitting, even though cherry-picking was attempted with {self.resolved_cherry_val_json_path}. "
                                 "Check if the file names in the JSON match actual data and if tiles exist.")
            else:
                raise ValueError("No validation samples found after splitting. This is unexpected.")


        if cfg.dataset_fraction < 1.0:
            print(f"\nTaking {cfg.dataset_fraction * 100:.1f}% of the dataset for training and validation")
            if len(train_df) > 0:
                train_df = train_df.sample(frac=cfg.dataset_fraction, random_state=random_state)
            if len(valid_df) > 0:
                valid_df = valid_df.sample(frac=cfg.dataset_fraction, random_state=random_state)

        if self.model_run_dir:
            os.makedirs(self.model_run_dir, exist_ok=True)
            target_val_file = os.path.join(self.model_run_dir, "validation_files_used_for_this_run.json")
            # Only save if we have validation data and are actually creating a new run dir context
            if not os.path.exists(target_val_file) and len(valid_df) > 0 :
                with open(target_val_file, "w") as f:
                    json.dump(valid_df["filename"].tolist(), f)

        train_image_paths = train_df['file_path'].tolist()
        val_image_paths = valid_df['file_path'].tolist()

        train_label_paths = [path.replace('images', 'labels') for path in train_image_paths]
        val_label_paths = [path.replace('images', 'labels') for path in val_image_paths]

        print(f"\nTotal train samples: {len(train_image_paths)}")
        print(f"Total validation samples: {len(val_image_paths)}")

        self.t_img_paths = train_image_paths
        self.t_label_paths = train_label_paths
        self.v_img_paths = val_image_paths
        self.v_label_paths = val_label_paths

    # ... (get_transforms, build_dataloader, train_dataloader, val_dataloader, info methods remain the same as previous answer) ...
    def get_transforms(self, dataset_type):
        if dataset_type == 'train':
            transforms = self.cfg.train_aug
            return A.Compose(transforms=transforms, is_check_shapes=False)
        elif dataset_type == 'val':
            transforms = self.cfg.val_aug
            return A.Compose(transforms=transforms, is_check_shapes=False)
        return None

    def build_dataloader(self, dataset_type):
        is_train = dataset_type == 'train'
        images_list = self.t_img_paths if is_train else self.v_img_paths
        label_list = self.t_label_paths if is_train else self.v_label_paths

        if is_train and not images_list:
            print("Warning: Training data list is empty. Returning None for train_dataloader.")
            return None

        dataset = SF_Dataset(
            cfg=self.cfg,
            root_dir=os.path.join(self.cfg.dataset_target_dir),
            images=images_list,
            labels=label_list,
            transform=self.get_transforms(dataset_type=dataset_type),
            mode=dataset_type
        )
        return DataLoader(
            dataset,
            batch_size=self.cfg.train_batch_size if is_train else self.cfg.val_batch_size,
            shuffle=is_train,
            num_workers=self.cfg.num_workers,
            pin_memory=True,
            drop_last=False
        )

    def train_dataloader(self):
        if not self.t_img_paths:
            print("No training data configured. Returning None for train_dataloader.")
            return None
        return self.build_dataloader(dataset_type='train')

    def val_dataloader(self):
        if not self.v_img_paths:
            print("No validation data configured. Returning None for val_dataloader.")
            return None
        return self.build_dataloader(dataset_type='val')

    def info(self):
        if self.v_img_paths is None:
            print("Dataset not initialized yet. Call generate_dataset first.")
            return
        for dataset_type in ['val']:
            print(f"\n{dataset_type.UPPER()} Dataset:")
            temp_loader = self.build_dataloader(dataset_type)
            if temp_loader is None:
                print(f"No dataloader for {dataset_type}")
                continue
            try:
                batch = next(iter(temp_loader))
                if isinstance(batch, (list, tuple)) and len(batch) >= 2:
                    images, labels = batch[0], batch[1]
                    print(f"Image shape: {images.shape}, Image type: {images.dtype}")
                    print(f"Label shape: {labels.shape}, Label type: {labels.dtype}")
                else:
                    print(f"Unknown batch format for {dataset_type} dataset")
            except StopIteration:
                print(f"No samples in {dataset_type} dataset")
            except Exception as e:
                print(f"Error inspecting {dataset_type} dataset: {str(e)}")
# --- END OF FILE data_module.py ---
