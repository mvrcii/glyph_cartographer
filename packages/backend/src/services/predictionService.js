import path from 'node:path';
import fsPromises from 'node:fs/promises';
import {glob} from 'glob';
import {OAI_PREDS_DATA_PATH, PREDS_DATA_PATH} from '../config/constants.js';

const log = (...args) => console.log('[service]', ...args);

// In-memory index of existing PNG prediction tiles: Map<short_model_name, Set<"x,y">>
const predictionIndex = new Map();

// In-memory index of existing OAI JSON prediction data: Map<short_model_name, Map<tileKey, oaiPredictionData>>
const oaiPredictionIndex = new Map();

let buildIndexesPromise = buildIndexes();

async function buildIndexes() {
    log('Building initial prediction indexes…');
    try {
        await Promise.all([buildPngIndex(), buildOaiIndex()]);
        log(
            `Initial indexes ready — PNG models: ${predictionIndex.size}, OAI models: ${oaiPredictionIndex.size}`
        );
    } catch (err) {
        console.error('[service] CRITICAL: error building initial prediction indexes:', err);
    }
}

async function buildPngIndex() {
    await fsPromises.mkdir(PREDS_DATA_PATH, {recursive: true});
    const files = await glob('**/*.png', {cwd: PREDS_DATA_PATH});

    for (const file of files) {
        const parts = file.replace(/\\/g, '/').split('/');
        if (parts.length === 4) {
            const [modelName, , x, yPng] = parts;
            const y = yPng.replace('.png', '');
            if (!predictionIndex.has(modelName)) {
                predictionIndex.set(modelName, new Set());
            }
            predictionIndex.get(modelName).add(`${x},${y}`);
        }
    }
    log(`PNG index built (${predictionIndex.size} models, ${files.length} files).`);
}

async function buildOaiIndex() {
    await fsPromises.mkdir(OAI_PREDS_DATA_PATH, {recursive: true});
    const files = await glob('**/*.json', {cwd: OAI_PREDS_DATA_PATH});

    oaiPredictionIndex.clear();
    for (const file of files) {
        const parts = file.replace(/\\/g, '/').split('/');
        if (parts.length !== 4) continue;

        const [modelName, , x, yJson] = parts;
        const y = yJson.replace('.json', '');
        const tileKey = `${x},${y}`;

        try {
            const filePath = path.join(OAI_PREDS_DATA_PATH, file);
            const fileContent = await fsPromises.readFile(filePath, 'utf-8');
            const oaiData = JSON.parse(fileContent);

            if (!oaiPredictionIndex.has(modelName)) {
                oaiPredictionIndex.set(modelName, new Map());
            }
            oaiPredictionIndex.get(modelName).set(tileKey, oaiData);
        } catch (err) {
            console.error(`[service] Failed to parse OAI prediction ${file}:`, err);
        }
    }
    log(`Initial OAI index built (${oaiPredictionIndex.size} models, ${files.length} files).`);
}

/**
 * Scans the file system for all OAI predictions for a single model and updates the in-memory index.
 * @param {string} modelName The short name of the model to index.
 */
async function buildOaiIndexForModel(modelName) {
    log(`Performing live OAI index build for model: '${modelName}'...`);
    const modelOaiData = new Map();
    const modelDir = path.join(OAI_PREDS_DATA_PATH, modelName);

    try {
        await fsPromises.access(modelDir);
    } catch {
        oaiPredictionIndex.set(modelName, modelOaiData);
        log(`No directory found for OAI model '${modelName}'. Index updated as empty.`);
        return;
    }

    const files = await glob('**/*.json', { cwd: modelDir });

    for (const file of files) {
        // Path inside modelDir is expected to be like "17/x/y.json"
        const parts = file.replace(/\\/g, '/').split('/');
        if (parts.length !== 3) continue;

        const [, x, yJson] = parts;
        const y = yJson.replace('.json', '');
        const tileKey = `${x},${y}`;

        try {
            const filePath = path.join(modelDir, file);
            const fileContent = await fsPromises.readFile(filePath, 'utf-8');
            const oaiData = JSON.parse(fileContent);
            modelOaiData.set(tileKey, oaiData);
        } catch (err) {
            console.error(`[service] Failed to parse live OAI prediction ${file}:`, err);
        }
    }

    oaiPredictionIndex.set(modelName, modelOaiData);
    log(`Live OAI index for '${modelName}' updated with ${modelOaiData.size} predictions.`);
}

export async function listModelsWithPredictions() {
    await buildIndexesPromise;
    return Array.from(predictionIndex.keys());
}

export async function getExistingPredictions(shortModelName) {
    await buildIndexesPromise;
    return Array.from(predictionIndex.get(shortModelName) || []);
}

export async function getExistingOaiPredictions(shortModelName) {
    // Rebuild the index for the requested model on every call to guarantee freshness.
    await buildOaiIndexForModel(shortModelName);

    const oaiDataMap = oaiPredictionIndex.get(shortModelName);

    if (!oaiDataMap) {
        return [];
    }

    const predictionsWithCoords = [];
    for (const [tileKey, oaiData] of oaiDataMap.entries()) {
        const [x, y] = tileKey.split(',').map(Number);

        if (isNaN(x) || isNaN(y)) {
            console.error(`[service] Invalid tileKey found in OAI index for model ${shortModelName}: ${tileKey}`);
            continue;
        }

        predictionsWithCoords.push({
            x: x,
            y: y,
            ...oaiData
        });
    }

    return predictionsWithCoords;
}

export async function getPredictionFilePath(shortModelName, z, x, y) {
    await buildIndexesPromise;
    let modelTiles = predictionIndex.get(shortModelName);

    if (modelTiles?.has(`${x},${y}`)) {
        return path.join(PREDS_DATA_PATH, shortModelName, String(z), String(x), `${y}.png`);
    }

    const tilePath = path.join(PREDS_DATA_PATH, shortModelName, String(z), String(x), `${y}.png`);
    try {
        await fsPromises.access(tilePath);
        if (!modelTiles) {
            modelTiles = new Set();
            predictionIndex.set(shortModelName, modelTiles);
        }
        modelTiles.add(`${x},${y}`);
        return tilePath;
    } catch {
        return null;
    }
}

export default {
    getExistingPredictions,
    getPredictionFilePath,
    listModelsWithPredictions,
    getExistingOaiPredictions,
};