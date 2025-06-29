import {getAvailableModels, runInference} from '../services/inferenceService.js';

const listAvailableModels = async (_req, res, next) => {
    try {
        const models = await getAvailableModels();
        res.status(200).json({success: true, models});
    } catch (err) {
        next(err);
    }
};

const processTileBatch = async (req, res, next) => {
    try {
        const {tiles, model_name, use_tta, use_oai, oai_model_name} = req.body;

        if (!tiles || !Array.isArray(tiles) || tiles.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Request body must contain a non-empty array of tiles.'
            });
        }
        if (!model_name) {
            return res.status(400).json({success: false, error: 'Request body must include a model_name.'});
        }

        const payload = {
            tiles,
            model_name,
            use_tta,
            use_oai,
            oai_model_name
        }

        const result = await runInference(payload);

        res.status(200).json({success: true, ...result});
    } catch (err) {
        next(err);
    }
};

export default {
    processTileBatch,
    listAvailableModels,
};