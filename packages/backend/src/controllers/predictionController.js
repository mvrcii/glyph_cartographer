import predictionService from '../services/predictionService.js';

async function listExistingPredictions(req, res) {
    try {
        const { short_model_name } = req.params;
        const tiles = await predictionService.getExistingPredictions(short_model_name);
        res.set('Cache-Control', 'no-store');
        res.json(tiles);
    } catch (err) {
        console.error('Error listing prediction tiles:', err);
        res.status(500).json([]);
    }
}

async function listExistingOaiPredictions(req, res) {
    try {
        const { short_model_name } = req.params;
        const oaiPredictions = await predictionService.getExistingOaiPredictions(short_model_name);
        res.set('Cache-Control', 'no-store');
        res.json(oaiPredictions);
    } catch (err) {
        console.error('Error listing OAI prediction data:', err);
        res.status(500).json([]);
    }
}

async function listModels(req, res) {
    try {
        const models = await predictionService.listModelsWithPredictions();
        res.set('Cache-Control', 'no-store');
        res.json(models);
    } catch (err) {
        console.error('Error listing models with predictions:', err);
        res.status(500).json([]);
    }
}

async function getPredictionTile(req, res) {
    try {
        const { short_model_name, z, x, y } = req.params;
        const yCoord = y.replace('.png', '');
        const filePath = await predictionService.getPredictionFilePath(short_model_name, z, x, yCoord);

        if (filePath) {
            res.set('Cache-Control', 'public, max-age=31536000, immutable');
            res.sendFile(filePath);
        } else {
            res.status(404).json({ success: false, error: 'Prediction tile not found' });
        }
    } catch (err) {
        console.error('Error getting prediction tile:', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
}

export default {listExistingPredictions, getPredictionTile, listModels, listExistingOaiPredictions};