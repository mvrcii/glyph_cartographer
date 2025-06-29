import labelsService from '../services/labelsService.js';

async function getAllLabelKeys(req, res, next) {
    try {
        const keys = await labelsService.getAllLabelKeys();
        res.status(200).json({ success: true, keys: Array.from(keys) });
    } catch (err) {
        next(err);
    }
}

async function getGoodNegatives(req, res, next) {
    try {
        const tiles = await labelsService.getGoodNegatives();
        res.status(200).json(Array.from(tiles));
    } catch (err) {
        next(err);
    }
}

async function updateGoodNegatives(req, res, next) {
    try {
        const tileKeys = req.body;
        if (!Array.isArray(tileKeys)) {
            return res.status(400).json({success: false, error: 'Request body must be an array of tile keys.'});
        }
        const result = await labelsService.updateGoodNegatives(tileKeys);
        res.status(200).json({success: true, ...result});
    } catch (err) {
        next(err);
    }
}

async function getLabelMask(req, res, next) {
    try {
        const {z, x, y} = req.params;
        const yCoord = y.replace('.png', '');
        const filePath = await labelsService.getLabelMaskPath(z, x, yCoord);

        if (filePath) {
            res.set('Cache-Control', 'no-cache');
            res.sendFile(filePath);
        } else {
            const transparentPng = await labelsService.createTransparentTile();
            res.set('Content-Type', 'image/png').set('Cache-Control', 'no-cache').send(transparentPng);
        }
    } catch (err) {
        next(err);
    }
}

async function saveLabelMask(req, res, next) {
    try {
        const {z, x, y} = req.params;
        const imageData = req.body;

        const result = await labelsService.saveLabelMask(z, x, y, imageData);

        res.status(200).json({
            success: true,
            message: `Label for ${z}/${x}/${y} ${result.action}.`,
            action: result.action
        });
    } catch (err) {
        next(err);
    }
}

export default {
    getAllLabelKeys,
    getGoodNegatives,
    updateGoodNegatives,
    getLabelMask,
    saveLabelMask
};