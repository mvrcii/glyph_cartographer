# 🛰️ Geoglyph Detection Pipeline

## ⚡ Quick Start (with Makefile)

```bash
make setup-data   # Install, configure, download tiles, and create dataset
make train         # Train using all patch sizes in config
```

Other useful commands:

```bash
make inspect-512      # Visualize 512×512 patches
make check-masks-256  # Check mask coverage for 256×256
make test             # Run installation test
```

---

## 🛠️ Manual Setup

```bash
# (Optional) Create conda env
conda create -n glyph python=3.12.2 -y && conda activate glyph

# Install dependencies
pip install -e .

# Set up API key in .env
python scripts/utils/setup_api_key.py

# Test installation
python scripts/utils/test_installation.py
```

---

## 🗺️ Download Tile Data

### Option A: Google Maps Tiles API via KML
```bash
# Preprocess KML (already pushed)
python scripts/download/preprocess_initial_kml.py

# Download tiles from KML
tile_download --kml data/kml_files/geoglyphs.kml --zoom 17 --max-parallel 5

# [Optional] Estimate API calls
python scripts/download/calculate_tiles_to_download_from_kml.py data/kml_files/geoglyphs.kml --zoom 17
```

### Option B: Download Pre-generated Tiles
```bash
gdown https://drive.google.com/uc?id=18UbZl38cP4N-nw0hiNkJPnWCV84-RV2e -O data/tiles.tar.gz
tar -xzvf data/tiles.tar.gz
```

---

## 📦 Dataset Preparation

```bash
# Create dataset at multiple scales (512, 256, 128)
python scripts/dataset/create_dataset_kml.py configs/base_kml.py

# [Optional] Visual tools
python scripts/dataset/inspect_patches.py --root data/datasets/multiscale --patch-size 512 -n 16
python scripts/dataset/check_masks.py --patch-size 256
```

---

## 🧠 Training

```bash
python scripts/train.py configs/base_kml.py
```

The config handles training across all patch sizes.



# Slippy Map Application
1. Navigate to frontend: `cd src/frontend`
2. Install dependencies: `pnpm install`
3. Start dev server `pnpm run dev`




### Generate a Self-Signed Certificate for Development
In your terminal, from the 'packages/backend' directory:
```bash
openssl req -x509 -newkey rsa:2048 -nodes -sha256 -subj '/CN=localhost' \
  -keyout localhost-privkey.pem -out localhost-cert.pem
```
This will create two files: localhost-privkey.pem (your private key) and localhost-cert.pem (your certificate).