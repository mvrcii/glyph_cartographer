import path from 'node:path';
import fs from 'node:fs/promises';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DISCOVERIES_JSON_PATH = path.join(DATA_DIR, 'discoveries.json');

/**
 * Ensures that the data directory exists.
 * @returns {Promise<void>}
 */
async function ensureDataDir() {
    try {
        await fs.mkdir(DATA_DIR, { recursive: true });
    } catch (err) {
        console.error("Could not create data directory.", err);
        throw err;
    }
}

/**
 * Safely reads the set of discovery tile keys from the JSON file.
 * @returns {Promise<Set<string>>} A promise that resolves to a Set of tile keys.
 */
async function getDiscoveries() {
    try {
        await fs.access(DISCOVERIES_JSON_PATH);
        const fileContent = await fs.readFile(DISCOVERIES_JSON_PATH, 'utf-8');
        const tiles = JSON.parse(fileContent);
        return new Set(tiles);
    } catch (err) {
        // If the file doesn't exist or is corrupt, return an empty set.
        if (err.code === 'ENOENT' || err instanceof SyntaxError) {
            return new Set();
        }
        throw err;
    }
}

/**
 * Overwrites the discoveries JSON file with a new, sorted array of tile keys.
 * @param {string[]} tileKeys - The new, complete list of discovery tiles.
 * @returns {Promise<{count: number}>} A promise that resolves with the count of saved keys.
 */
async function updateDiscoveries(tileKeys) {
    await ensureDataDir();
    // Ensure uniqueness with a Set and sort for consistency.
    const sortedKeys = [...new Set(tileKeys)].sort();
    const jsonContent = JSON.stringify(sortedKeys, null, 2);
    await fs.writeFile(DISCOVERIES_JSON_PATH, jsonContent);
    return { count: sortedKeys.length };
}


export default {
    getDiscoveries,
    updateDiscoveries,
};