import discoveriesService from '../services/discoveriesService.js';

async function getDiscoveries(req, res, next) {
    try {
        const tiles = await discoveriesService.getDiscoveries();
        // Convert the Set to an Array for the JSON response.
        res.status(200).json(Array.from(tiles));
    } catch (err) {
        next(err);
    }
}

async function updateDiscoveries(req, res, next) {
    try {
        const tileKeys = req.body;
        // Validate that the request body is an array.
        if (!Array.isArray(tileKeys)) {
            return res.status(400).json({success: false, error: 'Request body must be an array of tile keys.'});
        }
        const result = await discoveriesService.updateDiscoveries(tileKeys);
        res.status(200).json({success: true, ...result});
    } catch (err) {
        next(err);
    }
}

export default {
    getDiscoveries,
    updateDiscoveries,
};