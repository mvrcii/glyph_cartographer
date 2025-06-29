# Glyph Cartographer - A Geoglyph Detection Pipeline

A full-stack application for detecting ancient Amazonian geoglyphs using satellite imagery and deep learning.

## Prerequisites

- Node.js (v14+)
- Python (3.8+)
- Conda
- pnpm
- Google Maps API key
- OpenAI API key (optional, for AI-assisted predictions)

## Quick Start

### 1. Clone and Setup Environment

Clone the repository:
```shell
git clone https://github.com/mvrcii/glyph_cartographer.git
cd glyph_cartographer
```

Create and activate conda environment:
```shell
conda create -n glyph_cartographer python=3.12 -y
conda activate glyph_cartographer
```

### 2. Configure API Keys

Copy the example environment file:
```shell
cp packages/backend/.env.example packages/backend/.env
```

Edit the `.env` file and add your API keys:
- GOOGLE_MAPS_API_KEY=your_google_maps_api_key
- OPENAI_API_KEY=your_openai_api_key 

### 3. Install Dependencies

Install all dependencies (Python + Node.js):
```shell
pnpm setup
```

### 4. Create Google Maps Session Token

Generate session token for Google Maps API:
```shell
pnpm create-session
```

Enter your Google Maps API key when prompted.

### 5. Start the Application

Start both frontend and backend servers:
```shell
pnpm dev
```


The application will be available at:
- Frontend: http://localhost:5173
- Backend API: https://localhost:5000/api

## What's Included

- **Frontend**: React + TypeScript map interface for tile selection, inference, and labeling
- **Backend**: Node.js API server with Python inference service
- **ML Pipeline**: Segformer-based deep learning models for geoglyph detection
- **Tools**: Dataset creation, model training, and validation utilities

## Key Features

- Download satellite tiles from Google Maps
- Run ML inference on selected tiles
- Manual labeling interface for training data
- AI-assisted prediction filtering (requires OpenAI API)
- Multi-scale training pipeline
- Real-time visualization of predictions

## Troubleshooting

- Ensure all API keys are correctly set in the `.env` file
- The backend generates self-signed certificates automatically for HTTPS
- If port conflicts occur, check the `.env` file to modify default ports
- For detailed logs, check the console output of both frontend and backend servers