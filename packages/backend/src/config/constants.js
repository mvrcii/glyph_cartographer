import path, { dirname } from 'node:path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const ROOT_DIR = path.resolve(dirname(fileURLToPath(import.meta.url)), '../../../../');

// Load environment variables from the .env file at the project root
dotenv.config({ path: path.join(ROOT_DIR, 'packages/backend/.env') });

export const OUT_DIR = path.resolve(ROOT_DIR, process.env.TILE_DATA_PATH || 'data/tiles');
export const PREDS_DATA_PATH = path.resolve(ROOT_DIR, process.env.PREDS_PATH || 'data/preds');
export const OAI_PREDS_DATA_PATH = path.resolve(ROOT_DIR, process.env.OAI_PREDS_PATH || 'data/oai_preds');
export const LABELS_DIR = path.resolve(ROOT_DIR, process.env.LABELS_DIR || 'data/labels');
export const KML_DATA_PATH = path.resolve(ROOT_DIR, process.env.KML_DATA_PATH || 'data/kml_files');
export const PORT = process.env.PORT || 5000;
export const CONCURRENCY = Number(process.env.CONCURRENCY) || 10;