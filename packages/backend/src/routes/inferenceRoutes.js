import {Router} from 'express';
import inferenceController from '../controllers/inferenceController.js';
import predictionController from '../controllers/predictionController.js';

const router = Router();

router.get('/models', inferenceController.listAvailableModels);
router.post('/', inferenceController.processTileBatch);
router.get('/existing/:short_model_name', predictionController.listExistingPredictions);
router.get('/tile/:short_model_name/:z/:x/:y.png', predictionController.getPredictionTile);
router.get('/predictions/models', predictionController.listModels);

router.get('/oai/existing/:short_model_name', predictionController.listExistingOaiPredictions);


export default router;