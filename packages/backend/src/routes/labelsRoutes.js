import express, {Router} from 'express';
import labelsController from '../controllers/labelsController.js';

const router = Router();

const pngBodyParser = express.raw({type: 'image/png', limit: '1mb'});

// GET /api/labels/all - retrieves all tile keys that have a label
router.get('/all', labelsController.getAllLabelKeys);

// GET /api/labels/good_negatives
router.get('/good_negatives', labelsController.getGoodNegatives);

// POST /api/labels/good_negatives
router.post('/good_negatives', labelsController.updateGoodNegatives);

// GET /api/labels/image/:z/:x/:y.png - serves a single label mask
router.get('/image/:z/:x/:y.png', labelsController.getLabelMask);

// POST /api/labels/image/:z/:x/:y - saves a new label mask
router.post('/image/:z/:x/:y', pngBodyParser, labelsController.saveLabelMask);

export default router;