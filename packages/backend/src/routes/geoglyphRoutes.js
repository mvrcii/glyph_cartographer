import {Router} from 'express';
import geoglyphController from '../controllers/geoglyphController.js';

const router = Router();

// The route uses a ':filename' parameter.
// This will match requests like /api/geoglyphs/geoglyphs.kml
router.get('/:filename', geoglyphController.serveKMLFile);

export default router;