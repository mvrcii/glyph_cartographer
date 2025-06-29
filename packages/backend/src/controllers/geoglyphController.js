import fs from 'node:fs/promises';
import path from 'node:path';
import {KML_DATA_PATH} from '../config/constants.js';

async function serveKMLFile(req, res, next) {
    try {
        const {filename} = req.params;

        if (filename.includes('..') || !filename.endsWith('.kml')) {
            return res.status(400).json({success: false, error: 'Invalid filename'});
        }

        const kmlFilePath = path.join(KML_DATA_PATH, filename);
        const kmlData = await fs.readFile(kmlFilePath, 'utf-8');

        res.set('Content-Type', 'application/vnd.google-earth.kml+xml');
        res.send(kmlData);
    } catch (err) {
        if (err.code === 'ENOENT') {
            res.status(404).json({success: false, error: 'KML file not found'});
        } else {
            next(err);
        }
    }
}

export default {serveKMLFile};