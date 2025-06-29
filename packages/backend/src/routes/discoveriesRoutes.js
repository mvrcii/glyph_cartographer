import {Router} from 'express';
import discoveriesController from '../controllers/discoveriesController.js';

const router = Router();

// GET /api/discoveries - Fetches all discovery tile keys.
router.get('/', discoveriesController.getDiscoveries);

// POST /api/discoveries - Saves a new set of discovery tile keys.
router.post('/', discoveriesController.updateDiscoveries);

export default router;