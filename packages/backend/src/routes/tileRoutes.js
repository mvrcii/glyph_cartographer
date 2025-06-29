import {Router} from 'express';
import tileController from '../controllers/tileController.js';

const router = Router();

// GET /api/tiles/session-token
router.get('/session-token', tileController.getSessionToken);

// GET /api/tiles/download - downloads selected tiles via Server-Sent Events
router.get('/download', tileController.downloadTilesSSE);

// GET /api/tiles/sync-labels - downloads missing satellite tiles for all existing masks
router.get('/sync-labels', tileController.syncLabelsWithTilesSSE);

// GET /api/tiles/existing - lists all existing satellite tiles on disk
router.get('/existing', tileController.listExistingTiles);

// GET /api/tiles/satellite/:z/:x/:y.png - serves a single satellite image
router.get('/satellite/:z/:x/:y.png', tileController.getSatelliteTile);

export default router;