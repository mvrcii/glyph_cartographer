import { Router } from 'express';
import tileRoutes from './tileRoutes.js';
import inferenceRoutes from './inferenceRoutes.js';
import geoglyphRoutes from './geoglyphRoutes.js';
import labelsRoutes from "./labelsRoutes.js";
import discoveriesRoutes from './discoveriesRoutes.js';

const router = Router();

router.use('/tiles', tileRoutes);
router.use('/inference', inferenceRoutes);
router.use('/geoglyphs', geoglyphRoutes);
router.use('/labels', labelsRoutes);
router.use('/discoveries', discoveriesRoutes);

export default router;