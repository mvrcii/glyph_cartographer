import path from 'node:path';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import {LABELS_DIR} from '../config/constants.js';

const GOOD_NEGATIVES_JSON_PATH = path.join(path.dirname(LABELS_DIR), "good_negatives.json");
const TILE_SIZE = 512;
const Z = 17;

let transparentTileBuffer = null;

/**
 * Safely reads the set of good negative tile keys from the JSON file.
 * @returns {Promise<Set<string>>}
 */
async function getGoodNegatives() {
    try {
        await fs.access(GOOD_NEGATIVES_JSON_PATH);
        const fileContent = await fs.readFile(GOOD_NEGATIVES_JSON_PATH, 'utf-8');
        const tiles = JSON.parse(fileContent);
        return new Set(tiles);
    } catch (err) {
        // If file doesn't exist or is empty/corrupt, return an empty set.
        if (err.code === 'ENOENT' || err instanceof SyntaxError) {
            return new Set();
        }
        throw err;
    }
}

/**
 * Updates the good negatives list, creating/deleting empty masks as needed.
 * @param {string[]} newTileKeys - The new, complete list of good negative tiles.
 */
async function updateGoodNegatives(newTileKeys) {
    const newNegativesSet = new Set(newTileKeys);
    const currentNegativesSet = await getGoodNegatives();

    const addedTiles = [...newNegativesSet].filter(x => !currentNegativesSet.has(x));
    const removedTiles = [...currentNegativesSet].filter(x => !newNegativesSet.has(x));

    const blackImageBuffer = await sharp({
        create: {
            width: TILE_SIZE,
            height: TILE_SIZE,
            channels: 3,
            background: {r: 0, g: 0, b: 0}
        }
    }).png().toBuffer();

    for (const tileKey of addedTiles) {
        const [xStr, yStr] = tileKey.split(',');
        const labelDir = path.join(LABELS_DIR, String(Z), xStr);
        await fs.mkdir(labelDir, {recursive: true});
        const labelPath = path.join(labelDir, `${yStr}.png`);
        await fs.writeFile(labelPath, blackImageBuffer);
    }

    for (const tileKey of removedTiles) {
        const [xStr, yStr] = tileKey.split(',');
        const labelPath = path.join(LABELS_DIR, String(Z), xStr, `${yStr}.png`);
        await fs.rm(labelPath, {force: true});
    }

    await fs.writeFile(GOOD_NEGATIVES_JSON_PATH, JSON.stringify([...newNegativesSet].sort(), null, 2));
}


/**
 * Gets the file path for a label mask if it exists on disk.
 * @param {string} z The zoom level.
 * @param {string} x The x tile coordinate.
 * @param {string} y The y tile coordinate.
 * @returns {Promise<string|null>} The full file path or null if it doesn't exist.
 */
async function getLabelMaskPath(z, x, y) {
    const filePath = path.join(LABELS_DIR, String(z), String(x), `${y}.png`);
    try {
        await fs.access(filePath);
        return filePath;
    } catch {
        return null;
    }
}

/**
 * Creates a 512x512 transparent PNG buffer using Sharp, caching the result.
 * @returns {Promise<Buffer>} A buffer containing the transparent PNG data.
 */
async function createTransparentTile() {
    if (transparentTileBuffer) {
        return transparentTileBuffer;
    }
    transparentTileBuffer = await sharp({
        create: {
            width: TILE_SIZE,
            height: TILE_SIZE,
            channels: 4,
            background: {r: 0, g: 0, b: 0, alpha: 0}
        }
    }).png().toBuffer();
    return transparentTileBuffer;
}

/**
 * Saves a label mask PNG buffer, or deletes the file if the mask is empty.
 * @param {string} z The zoom level.
 * @param {string} x The x tile coordinate.
 * @param {string} y The y tile coordinate.
 * @param {Buffer} imageData The raw image buffer received from the request.
 * @returns {Promise<{action: 'saved' | 'deleted'}>} The action that was performed.
 */
async function saveLabelMask(z, x, y, imageData) {
    const labelDir = path.join(LABELS_DIR, String(z), String(x));
    const labelPath = path.join(labelDir, `${y}.png`);

    // The masks are white drawings on a black background. If the max value
    // of the first channel (R) is 0, the image is completely black.
    const stats = await sharp(imageData).stats();
    const isEmpty = stats.channels[0].max === 0;

    if (isEmpty) {
        await fs.rm(labelPath, { force: true });
        return { action: 'deleted' };
    } else {
        await fs.mkdir(labelDir, { recursive: true });
        await fs.writeFile(labelPath, imageData);
        return { action: 'saved' };
    }
}

/**
 * Recursively finds all label image files and extracts their tile keys.
 * @returns {Promise<Set<string>>} A set of all tile keys like "x,y".
 */
async function getAllLabelKeys() {
    const allKeys = new Set();
    try {
        await fs.access(LABELS_DIR);

        const zoomLevels = await fs.readdir(LABELS_DIR, {withFileTypes: true});
        for (const zoomLevel of zoomLevels) {
            if (!zoomLevel.isDirectory()) continue;

            const xDirs = await fs.readdir(path.join(LABELS_DIR, zoomLevel.name), {withFileTypes: true});
            for (const xDir of xDirs) {
                if (!xDir.isDirectory()) continue;

                const yFiles = await fs.readdir(path.join(LABELS_DIR, zoomLevel.name, xDir.name));
                for (const yFile of yFiles) {
                    if (yFile.endsWith('.png')) {
                        const y = yFile.replace('.png', '');
                        const x = xDir.name;
                        allKeys.add(`${x},${y}`);
                    }
                }
            }
        }
    } catch (err) {
        if (err.code === 'ENOENT') {
            console.log("Labels directory doesn't exist yet. Returning empty set.");
            return new Set();
        }
        console.error('Error scanning label directory:', err);
        throw err;
    }
    return allKeys;
}

export default {
    getGoodNegatives,
    updateGoodNegatives,
    getLabelMaskPath,
    createTransparentTile,
    saveLabelMask,
    getAllLabelKeys,
};