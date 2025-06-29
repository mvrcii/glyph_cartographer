import albumentations as A

data_root_dir = 'data'
dataset_target_dir = 'data/datasets/512_28_06'

# Architecture
model_type = 'b5'
architecture = 'sf'
segformer_from_pretrained = f'nvidia/mit-{model_type}'
model_name = 'sf-b5'
in_chans = 3

# Training Parameters
patch_size = 512
label_size = patch_size // 4

# Dataset Creation Parameters
subpatch_sizes = [512]
subpatch_strides = [512]

# Trainer
node = True
num_workers = 0
seed = 105605
val_interval = 1
gradient_clip_val = 1
monitor_metric = "val_iou"

# Data
val_frac = 0.1
dataset_fraction = 1
glyph_ratio = 0.4 # 256 -> 3, 512 -> 0.4
no_glyph_sample_percentage = 0.75 # for every 100 "positives" we add 75 negatives (fully black label)
train_batch_size = 8
val_batch_size = 16

# Optimizer
weight_decay = 0.0001
label_smoothing = 0.1

# Learning rate schedule
epochs = 70
lr = 2e-4
warmup_epochs = 5
cos_eta_min = 5e-05
cos_max_epochs = 70

# Augmentations
train_aug = [
    A.HorizontalFlip(p=0.5),
    A.VerticalFlip(p=0.5),
    A.Rotate(limit=360, p=0.5),
    A.Perspective(scale=(0.03, 0.03), p=0.1),
    A.GridDistortion(p=0.1),
    A.Blur(blur_limit=3, p=0.1),
    A.GaussNoise(p=0.1),
    A.RandomResizedCrop(size=(patch_size, patch_size), scale=(0.5, 1.0), ratio=(0.75, 1.333), p=0.15),
    A.Affine(
        translate_percent={'x': (-0.0625, 0.0625), 'y': (-0.0625, 0.0625)},
        scale=(0.9, 1.1),
        rotate=(-360, 360),
        p=0.1
    ),
    A.RandomGamma(p=0.15, gamma_limit=(30, 80)),
    A.RandomBrightnessContrast(p=0.15, brightness_limit=(-0.2, 0.4), contrast_limit=(-0.2, 0.2)),
    A.Normalize(mean=(0, 0, 0), std=(1, 1, 1))
]
val_aug = [
    A.Normalize(mean=(0, 0, 0), std=(1, 1, 1))
]
