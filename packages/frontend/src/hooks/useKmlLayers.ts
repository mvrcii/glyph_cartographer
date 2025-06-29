import React, {useEffect, useMemo, useRef, useState} from "react";
import L from "leaflet";
import type {Geoglyph} from "../utils/kmlUtils.ts";
import {parseKML} from "../utils/kmlUtils.ts";
import type {KmlLayerConfig} from "../App";
import {TILE_GRID_ZOOM, ZOOM_THRESHOLD} from '../config/mapConstants';
import {lat2tile, lon2tile} from "../utils/tileMathUtils.ts";
import { createAggregatedTileMap } from "../utils/tileDrawingUtils.ts";

const BASE_LINE_WEIGHT = 5;

// --- AGGREGATION CONSTANTS (mirrored from useMapLayers.ts) ---
const AGGREGATION_LEVELS = [
    {mapZoomThreshold: 0, displayTileZoom: 5, padFactor: 1.0},
    {mapZoomThreshold: 5, displayTileZoom: 7, padFactor: 1.0},
    {mapZoomThreshold: 6, displayTileZoom: 9, padFactor: 0.8},
    {mapZoomThreshold: 7, displayTileZoom: 11, padFactor: 0.5},
    {mapZoomThreshold: 9, displayTileZoom: 13, padFactor: 0.2},
    {mapZoomThreshold: 10, displayTileZoom: 14, padFactor: 0.3},
    {mapZoomThreshold: 11, displayTileZoom: 15, padFactor: 0.5},
    {mapZoomThreshold: 12, displayTileZoom: TILE_GRID_ZOOM, padFactor: 0.5}
];
const QUANTILE_BUCKETS = 5;
const OPACITY_LEVELS = [0.15, 0.30, 0.45, 0.60, 0.8];


const createQuantileOpacityMap = (sourceTiles: Set<string>) => {
    const allLevels = new Map<number, Map<string, number>>();
    AGGREGATION_LEVELS.forEach(levelConfig => {
        const tileCountsMap = createAggregatedTileMap(sourceTiles, TILE_GRID_ZOOM, levelConfig.displayTileZoom);
        if (levelConfig.displayTileZoom === TILE_GRID_ZOOM) {
            allLevels.set(levelConfig.displayTileZoom, tileCountsMap);
            return;
        }
        const tileOpacities = new Map<string, number>();
        const counts = Array.from(tileCountsMap.values()).sort((a, b) => a - b);
        if (counts.length === 0) {
            allLevels.set(levelConfig.displayTileZoom, tileOpacities);
            return;
        }
        const thresholds: number[] = [];
        for (let i = 1; i < QUANTILE_BUCKETS; i++) {
            const index = Math.floor(i * counts.length / QUANTILE_BUCKETS);
            thresholds.push(counts[index]);
        }
        tileCountsMap.forEach((count, key) => {
            let bucketIndex = 0;
            while (bucketIndex < thresholds.length && count > thresholds[bucketIndex]) {
                bucketIndex++;
            }
            tileOpacities.set(key, OPACITY_LEVELS[bucketIndex]);
        });
        allLevels.set(levelConfig.displayTileZoom, tileOpacities);
    });
    return allLevels;
};


interface UseKmlLayersProps {
    leafletMap: L.Map | null;
    layersConfig: KmlLayerConfig[];
    visibility: { [filename: string]: boolean };
    kmlRenderers: React.MutableRefObject<Map<string, L.Canvas>>;
    setKmlGeoglyphCounts: React.Dispatch<React.SetStateAction<Record<string, number>>>;
    kmlLayerVersions: Map<string, number>;
}

function getTilesOnLine(x1: number, y1: number, x2: number, y2: number): Set<string> {
    const tiles = new Set<string>();
    let dx = Math.abs(x2 - x1);
    let dy = -Math.abs(y2 - y1);
    let sx = x1 < x2 ? 1 : -1;
    let sy = y1 < y2 ? 1 : -1;
    let err = dx + dy;

    while (true) {
        tiles.add(`${x1},${y1}`);
        if (x1 === x2 && y1 === y2) break;
        const e2 = 2 * err;
        if (e2 >= dy) {
            err += dy;
            x1 += sx;
        }
        if (e2 <= dx) {
            err += dx;
            y1 += sy;
        }
    }
    return tiles;
}

export function useKmlLayers({
                                 leafletMap,
                                 layersConfig,
                                 visibility,
                                 kmlRenderers,
                                 setKmlGeoglyphCounts,
                                 kmlLayerVersions,
                             }: UseKmlLayersProps) {
    const layerGroups = useRef(new Map<string, { lines: L.LayerGroup }>());
    const [kmlTileSets, setKmlTileSets] = useState(new Map<string, Set<string>>());
    const [aggregatedKmlTiles, setAggregatedKmlTiles] = useState(new Map<string, Map<number, Map<string, number>>>());
    const loadedData = useRef(new Map<string, number>());

    // Effect to fetch KML, parse it, and calculate the tile sets
    useEffect(() => {
        if (!leafletMap) return;

        // Clean up layers that are no longer in config
        layerGroups.current.forEach((group, filename) => {
            if (!layersConfig.some(c => c.filename === filename)) {
                if (leafletMap.hasLayer(group.lines)) leafletMap.removeLayer(group.lines);
                layerGroups.current.delete(filename);
                loadedData.current.delete(filename);
            }
        });

        layersConfig.forEach(config => {
            const currentVersion = kmlLayerVersions.get(config.filename) || 0;
            const loadedVersion = loadedData.current.get(config.filename);

            // If we have loaded this version or a newer one, skip.
            if (loadedVersion !== undefined && loadedVersion >= currentVersion) {
                return;
            }

            // If a layer already exists, remove it before refetching
            const existingGroup = layerGroups.current.get(config.filename);
            if (existingGroup && leafletMap.hasLayer(existingGroup.lines)) {
                leafletMap.removeLayer(existingGroup.lines);
            }

            fetch(`/api/geoglyphs/${config.filename}`)
                .then(res => {
                    if (!res.ok) throw new Error(`Request failed for ${config.filename}`);
                    return res.text();
                })
                .then(kmlText => {
                    const geoglyphs = parseKML(kmlText);
                    setKmlGeoglyphCounts(prev => ({...prev, [config.filename]: geoglyphs.length}));

                    const lines = L.layerGroup();
                    const fileTileSet = new Set<string>();
                    const renderer = kmlRenderers.current.get(config.filename);
                    const lineStyle = {
                        color: config.color,
                        weight: BASE_LINE_WEIGHT,
                        opacity: config.opacity ?? 0.8,
                        renderer: renderer
                    };

                    geoglyphs.forEach((glyph: Geoglyph) => {
                        L.polyline(glyph.points, lineStyle).addTo(lines);
                        for (let i = 0; i < glyph.points.length - 1; i++) {
                            const p1 = glyph.points[i] as [number, number];
                            const p2 = glyph.points[i + 1] as [number, number];
                            const t1x = lon2tile(p1[1], TILE_GRID_ZOOM);
                            const t1y = lat2tile(p1[0], TILE_GRID_ZOOM);
                            const t2x = lon2tile(p2[1], TILE_GRID_ZOOM);
                            const t2y = lat2tile(p2[0], TILE_GRID_ZOOM);
                            const tilesForSegment = getTilesOnLine(t1x, t1y, t2x, t2y);
                            tilesForSegment.forEach(tile => fileTileSet.add(tile));
                        }
                    });

                    const aggregatedData = createQuantileOpacityMap(fileTileSet);

                    layerGroups.current.set(config.filename, {lines});
                    setKmlTileSets(prev => new Map(prev).set(config.filename, fileTileSet));
                    setAggregatedKmlTiles(prev => new Map(prev).set(config.filename, aggregatedData));
                    loadedData.current.set(config.filename, currentVersion); // Mark this version as loaded

                    updateLayerVisibility(leafletMap.getZoom());
                })
                .catch(err => console.error(`Failed to load KML ${config.filename}`, err));
        });
    }, [layersConfig, leafletMap, kmlRenderers, setKmlGeoglyphCounts, kmlLayerVersions]);

    const updateLayerVisibility = (currentZoom: number) => {
        if (!leafletMap) return;
        layerGroups.current.forEach(({lines}, filename) => {
            const isVisible = visibility[filename];
            const showLines = isVisible && currentZoom >= ZOOM_THRESHOLD;

            if (showLines) {
                if (!leafletMap.hasLayer(lines)) leafletMap.addLayer(lines);
            } else {
                if (leafletMap.hasLayer(lines)) leafletMap.removeLayer(lines);
            }
        });
    };

    // Effect to handle dynamic style updates for lines (e.g., color changes)
    useEffect(() => {
        if (!leafletMap) return;
        // Iterate over layersConfig to get each 'config' object
        layersConfig.forEach(config => {
            const group = layerGroups.current.get(config.filename);
            if (group) {
                group.lines.eachLayer(layer => {
                    if (typeof (layer as L.Path).setStyle === 'function') {
                        (layer as L.Path).setStyle({color: config.color, opacity: config.opacity ?? 0.8});
                    }
                });
            }
        });
    }, [layersConfig, leafletMap]);


    // Effect to handle visibility and zoom changes
    useEffect(() => {
        if (!leafletMap) return;
        const handleZoom = () => updateLayerVisibility(leafletMap.getZoom());
        handleZoom();
        leafletMap.on('zoomend', handleZoom);
        return () => {
            leafletMap.off('zoomend', handleZoom);
            layerGroups.current.forEach(({lines}) => {
                if (leafletMap.hasLayer(lines)) leafletMap.removeLayer(lines);
            });
        };
    }, [leafletMap, visibility, layersConfig]);

    const memoizedKmlData = useMemo(() => ({
        kmlTileSets,
        aggregatedKmlTiles
    }), [kmlTileSets, aggregatedKmlTiles]);

    return memoizedKmlData;
}