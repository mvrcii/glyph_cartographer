import path from 'node:path';
import fsPromises from 'node:fs/promises';
import fetch from 'node-fetch';
import {spawnSync} from 'node:child_process';
import pLimit from 'p-limit';
import {CONCURRENCY, OUT_DIR} from '../config/constants.js';

// In-memory index of existing tiles ("x,y" strings)
const existingTiles = new Set();
let buildIndexPromise = buildIndex();

async function buildIndex() {
    console.log('[TILE_SERVICE] Building tile index...');
    existingTiles.clear();

    async function walk(dir) {
        const ents = await fsPromises.readdir(dir, {withFileTypes: true});
        await Promise.all(
            ents.map(async (ent) => {
                const p = path.join(dir, ent.name);
                if (ent.isDirectory()) return walk(p);
                if (ent.isFile() && ent.name.endsWith('.png')) {
                    const rel = path.relative(OUT_DIR, p).replace(/\\/g, '/'); // z/x/y.png
                    const [, x, yPng] = rel.split('/');
                    if (x && yPng) existingTiles.add(`${x},${yPng.replace('.png', '')}`);
                }
            }),
        );
    }

    await fsPromises.mkdir(OUT_DIR, {recursive: true}).catch(() => {});
    await walk(OUT_DIR);
    console.log(`[TILE_SERVICE] Indexed ${existingTiles.size} existing tiles`);
}

async function rebuildIndex() {
    console.log('[TILE_SERVICE] Force rebuilding tile index...');
    buildIndexPromise = buildIndex();
    await buildIndexPromise;
    return {tiles: Array.from(existingTiles), count: existingTiles.size};
}

export async function getExistingTiles(forceRefresh = false) {
    if (forceRefresh) {
        console.log('[TILE_SERVICE] Force refresh requested');
        return await rebuildIndex();
    }
    await buildIndexPromise;
    return {tiles: Array.from(existingTiles), count: existingTiles.size};
}

export async function loadSessionToken() {
    const shellCmd =
        'if [ -f ~/.bash_profile ]; then source ~/.bash_profile; fi; ' +
        'if [ -f ~/.profile ]; then source ~/.profile; fi; ' +
        'echo "$SESSION_TOKEN"';
    const {status, stdout} = spawnSync('bash', ['-c', shellCmd]);
    return status === 0 ? stdout.toString().trim() : '';
}

async function saveTile(response, filePath) {
    await fsPromises.mkdir(path.dirname(filePath), {recursive: true});
    const fh = await fsPromises.open(filePath, 'w');
    await new Promise((res, rej) => {
        response.body.pipe(fh.createWriteStream());
        response.body.on('end', res);
        response.body.on('error', rej);
    });
    await fh.close();
}

function gmapsUrl(x, y, z, key = '', session = '') {
    const base = `https://mts0.google.com/vt/lyrs=s&x=${x}&y=${y}&z=${z}&scale=2`;
    const q = [];
    if (key) q.push(`key=${encodeURIComponent(key)}`);
    if (session) q.push(`token=${encodeURIComponent(session)}`);
    return q.length ? `${base}&${q.join('&')}` : base;
}

export async function fetchTileNode(x, y, z, apiKey, sessionToken, overwrite) {
    const outPath = path.join(OUT_DIR, String(z), String(x), `${y}.png`);
    if (!overwrite) {
        try {
            await fsPromises.access(outPath);
            return false;
        } catch {}
    }
    const url = gmapsUrl(x, y, z, apiKey, sessionToken);
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    await saveTile(resp, outPath);
    existingTiles.add(`${x},${y}`);
    return true;
}

export async function streamTiles({zoom, apiKey, overwrite, tiles, res}) {
    const sessionToken = await loadSessionToken();
    const work = Array.isArray(tiles) && tiles.length ? tiles : [];

    if (work.length === 0) {
        res.write('event: end\n');
        res.write('data: No tiles to download\n\n');
        return res.end();
    }

    const limit = pLimit(CONCURRENCY);
    let completed = 0;

    await Promise.all(
        work.map(([x, y]) =>
            limit(async () => {
                try {
                    const downloaded = await fetchTileNode(x, y, zoom, apiKey, sessionToken, overwrite);
                    const msg = downloaded ? `${x},${y}` : `skip ${x},${y}`;

                    res.write(`data: ${msg}\n\n`);
                    if (res.flush) res.flush();

                    completed++;

                    if (completed % 10 === 0 || completed === work.length) {
                        console.log(`[STREAM_TILES] Satellite progress: ${completed}/${work.length} (${Math.round(completed / work.length * 100)}%)`);
                    }
                } catch (err) {
                    console.error(`[STREAM_TILES] Error downloading ${x},${y}:`, err.message);
                    res.write(`data: error ${x},${y} → ${err.message}\n\n`);
                    if (res.flush) res.flush();
                }
            }),
        ),
    );

    console.log(`[STREAM_TILES] Satellite downloads completed: ${completed}/${work.length} processed`);

    res.write('event: end\n');
    res.write('data: Download completed\n\n');
    res.end();
}

export async function getTileFilePath(z, x, y) {
    await buildIndexPromise;

    if (existingTiles.has(`${x},${y}`)) {
        const tilePath = path.join(OUT_DIR, String(z), String(x), `${y}.png`);
        try {
            await fsPromises.access(tilePath);
            return tilePath;
        } catch {
            // File was deleted, remove from cache
            existingTiles.delete(`${x},${y}`);
            return null;
        }
    }
    return null;
}

export default {
    loadSessionToken,
    streamTiles,
    getExistingTiles,
    getTileFilePath
};