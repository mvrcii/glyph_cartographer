import tileService, {streamTiles} from '../services/tileService.js';
import labelsService from '../services/labelsService.js';

async function getSessionToken(_req, res) {
    const token = await tileService.loadSessionToken();
    res.json({success: true, token});
}

async function listExistingTiles(_req, res) {
    const {tiles, count} = await tileService.getExistingTiles();
    res.set('Cache-Control', 'public, max-age=30');
    res.json({success: true, tiles, count});
}

async function downloadTilesSSE(req, res) {
    try {
        const payload = req.query.d ? JSON.parse(req.query.d) : {};
        const zoom = Number(req.query.zoom ?? payload.zoom);
        const apiKey = req.query.apiKey ?? payload.apiKey;
        const overwrite = (req.query.overwrite ?? payload.overwrite) === 'true';
        const tiles = payload.tiles;

        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
        });

        await tileService.streamTiles({zoom, apiKey, overwrite, tiles, res});
    } catch (err) {
        console.error('Download error:', err);
        res.write(`data: error ${err.message}\n\n`);
        res.end();
    }
}

async function syncLabelsWithTilesSSE(req, res) {
    console.log('[SYNC_LABELS] Starting label-satellite sync...');
    try {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
        });
        res.flushHeaders();

        // Phase 1: Analyze what we need
        console.log('[SYNC_LABELS] Phase 1: Analyzing training data requirements...');

        const allLabelKeys = await labelsService.getAllLabelKeys();
        const goodNegativeKeys = await labelsService.getGoodNegatives();
        const requiredTiles = new Set([...allLabelKeys, ...goodNegativeKeys]);

        console.log(`[SYNC_LABELS] Found ${allLabelKeys.size} labels, ${goodNegativeKeys.size} negatives`);
        console.log(`[SYNC_LABELS] Total ${requiredTiles.size} unique tiles require satellite imagery`);

        // Phase 2: Check for missing mask files for good negatives
        console.log('[SYNC_LABELS] Phase 2: Checking mask file consistency...');

        const negativesWithoutMasks = [...goodNegativeKeys].filter(key => !allLabelKeys.has(key));
        console.log(`[SYNC_LABELS] Found ${negativesWithoutMasks.length} good negatives missing mask files`);

        // Phase 3: Check for missing satellite tiles
        console.log('[SYNC_LABELS] Phase 3: Checking satellite tile availability...');

        const {tiles: existingTileKeys} = await tileService.getExistingTiles(true); // Force refresh
        const existingTiles = new Set(existingTileKeys);
        const missingTiles = [...requiredTiles].filter(key => !existingTiles.has(key));

        console.log(`[SYNC_LABELS] Found ${existingTiles.size} existing satellites, ${missingTiles.length} missing`);

        // Calculate total work
        const totalTasks = negativesWithoutMasks.length + missingTiles.length;

        // Send total count
        res.write(`event: total\n`);
        res.write(`data: ${totalTasks}\n\n`);
        if (res.flush) res.flush();

        if (totalTasks === 0) {
            console.log('[SYNC_LABELS] All training data is synchronized - nothing to do');
            res.write('event: end\n');
            res.write('data: All training data is synchronized\n\n');
            res.end();
            return;
        }

        let completedTasks = 0;

        // Phase 4: Create missing mask files
        if (negativesWithoutMasks.length > 0) {
            console.log(`[SYNC_LABELS] Phase 4: Creating ${negativesWithoutMasks.length} missing mask files...`);

            const createdMasks = await createMissingMaskFiles(negativesWithoutMasks, res, completedTasks);
            completedTasks += createdMasks;

            console.log(`[SYNC_LABELS] Created ${createdMasks} mask files`);
        }

        // Phase 5: Download missing satellite tiles
        if (missingTiles.length > 0) {
            console.log(`[SYNC_LABELS] Phase 5: Downloading ${missingTiles.length} missing satellite tiles...`);

            const tiles = missingTiles
                .map(k => k.split(',').map(Number))
                .filter(pair => pair.length === 2);

            const zoom = 17;
            const apiKey = await tileService.loadSessionToken();

            await streamTiles({
                zoom,
                apiKey,
                overwrite: false,
                tiles,
                res,
                startingProgress: completedTasks
            });
        } else {
            // Send end event if we only created masks (no tiles to download)
            console.log('[SYNC_LABELS] Sync completed successfully');
            res.write('event: end\n');
            res.write('data: Sync completed\n\n');
            res.end();
        }

    } catch (err) {
        console.error('[SYNC_LABELS] Error during sync:', err);
        res.write(`event: error\n`);
        res.write(`data: ${JSON.stringify({message: err.message})}\n\n`);
        res.end();
    }
}

async function createMissingMaskFiles(missingTileKeys, res, startingProgress) {
    const sharp = (await import('sharp')).default;
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const {LABELS_DIR} = await import('../config/constants.js');

    const TILE_SIZE = 512;
    const Z = 17;

    const blackImageBuffer = await sharp({
        create: {
            width: TILE_SIZE,
            height: TILE_SIZE,
            channels: 3,
            background: {r: 0, g: 0, b: 0}
        }
    }).png().toBuffer();

    let created = 0;

    for (const tileKey of missingTileKeys) {
        try {
            const [xStr, yStr] = tileKey.split(',');
            const labelDir = path.join(LABELS_DIR, String(Z), xStr);
            await fs.mkdir(labelDir, {recursive: true});
            const labelPath = path.join(labelDir, `${yStr}.png`);
            await fs.writeFile(labelPath, blackImageBuffer);

            created++;

            res.write(`data: mask_${tileKey}\n\n`);
            if (res.flush) res.flush();

            console.log(`[SYNC_LABELS] Created mask file for ${tileKey} (${created}/${missingTileKeys.length})`);

        } catch (err) {
            console.error(`[SYNC_LABELS] Failed to create mask for ${tileKey}:`, err);
            res.write(`data: error mask_${tileKey} → ${err.message}\n\n`);
            if (res.flush) res.flush();
        }
    }

    return created;
}

async function getSatelliteTile(req, res) {
    try {
        const {z, x, y} = req.params;
        const yCoord = y.replace('.png', '');

        const filePath = await tileService.getTileFilePath(z, x, yCoord);

        if (filePath) {
            res.set('Cache-Control', 'public, max-age=31536000, immutable');
            res.sendFile(filePath);
        } else {
            res.status(404).json({success: false, error: 'Tile not found'});
        }
    } catch (err) {
        console.error('Error getting tile:', err);
        res.status(500).json({success: false, error: 'Internal server error'});
    }
}

export default {
    getSessionToken,
    listExistingTiles,
    downloadTilesSSE,
    getSatelliteTile,
    syncLabelsWithTilesSSE
};