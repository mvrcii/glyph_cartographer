import {useCallback, useEffect, useMemo, useRef} from 'react';
import L from 'leaflet';
import throttle from 'lodash/throttle';
import type {Mode} from '../types';
import {createAggregatedTileMap, drawTiles, type TileStyle} from "../utils/tileDrawingUtils.ts";

const ORANGE_PAD_DEFAULT = 1.0;
const SOURCE_TILE_ZOOM = 17;

export const AGGREGATION_LEVELS = [
    // mapZoomThreshold: Min map zoom for this config to apply. Sorted low to high.
    {mapZoomThreshold: 0, displayTileZoom: 5, padFactor: 1.0},
    {mapZoomThreshold: 5, displayTileZoom: 7, padFactor: 1.0},
    {mapZoomThreshold: 6, displayTileZoom: 9, padFactor: 0.8},
    {mapZoomThreshold: 7, displayTileZoom: 11, padFactor: 0.5},
    {mapZoomThreshold: 9, displayTileZoom: 13, padFactor: 0.2},
    {mapZoomThreshold: 10, displayTileZoom: 14, padFactor: 0.3},
    {mapZoomThreshold: 11, displayTileZoom: 15, padFactor: 0.5},
    {mapZoomThreshold: 12, displayTileZoom: SOURCE_TILE_ZOOM, padFactor: ORANGE_PAD_DEFAULT}
];

const QUANTILE_BUCKETS = 5;
const OPACITY_LEVELS = [0.15, 0.30, 0.45, 0.60, 0.8];


export interface RenderCounts {
    orange: number;
    selected: number;
    downloading: number;
    goodNegatives: number;
    discoveries: number;
    positiveLabels: number;
}

interface UseMapLayersProps {
    leafletMap: L.Map | null;
    mode: Mode;
    downloaded: Set<string>;
    selected: Set<string>;
    downloading: Set<string>;
    goodNegatives: Set<string>;
    discoveries: Set<string>;
    positiveLabels: Set<string>;
    showExistingTiles: boolean;
    showGoodNegatives: boolean;
    showDiscoveries: boolean;
    showLabels: boolean;
    labelsColor: string;
    labelsOpacity: number;
    discoveriesColor: string;
    zoomThreshold: number;
    orangeLayer: L.LayerGroup;
    selectedLayer: L.LayerGroup;
    downloadingLayer: L.LayerGroup;
    goodNegativesLayer: L.LayerGroup;
    discoveriesLayer: L.LayerGroup;
    labelsAggregatedLayer: L.LayerGroup;
    orangeRenderer: L.Canvas | null;
    selectedRenderer: L.Canvas | null;
    downloadingRenderer: L.Canvas | null;
    goodNegativesRenderer: L.Canvas | null;
    discoveriesRenderer: L.Canvas | null;
    labelsAggregatedRenderer: L.Canvas | null;
    onRenderCountsChange: (counts: RenderCounts) => void;
}

export function useMapLayers({
                                 leafletMap,
                                 mode,
                                 downloaded,
                                 selected,
                                 downloading,
                                 goodNegatives,
                                 discoveries,
                                 positiveLabels,
                                 showExistingTiles,
                                 showGoodNegatives,
                                 showDiscoveries,
                                 showLabels,
                                 labelsColor,
                                 labelsOpacity,
                                 discoveriesColor,
                                 zoomThreshold,
                                 orangeLayer,
                                 selectedLayer,
                                 downloadingLayer,
                                 goodNegativesLayer,
                                 discoveriesLayer,
                                 labelsAggregatedLayer,
                                 orangeRenderer,
                                 selectedRenderer,
                                 downloadingRenderer,
                                 goodNegativesRenderer,
                                 discoveriesRenderer,
                                 labelsAggregatedRenderer,
                                 onRenderCountsChange,
                             }: UseMapLayersProps) {

    const renderedOrange = useRef<Set<string>>(new Set());
    const renderedSelected = useRef<Set<string>>(new Set());
    const renderedDownloading = useRef<Set<string>>(new Set());
    const renderedGoodNegatives = useRef<Set<string>>(new Set());
    const renderedDiscoveries = useRef<Set<string>>(new Set());
    const renderedPositiveLabels = useRef<Set<string>>(new Set());

    const lastOrangeDisplayZoom = useRef<number | null>(null);
    const lastGoodNegativesDisplayZoom = useRef<number | null>(null);
    const lastDiscoveriesDisplayZoom = useRef<number | null>(null);
    const lastPositiveLabelsDisplayZoom = useRef<number | null>(null);

    const createQuantileOpacityMap = (sourceTiles: Set<string>) => {
        const allLevels = new Map<number, Map<string, number>>();

        AGGREGATION_LEVELS.forEach(levelConfig => {
            if (levelConfig.displayTileZoom === SOURCE_TILE_ZOOM) {
                const tileMap = new Map<string, number>();
                sourceTiles.forEach(key => tileMap.set(key, 1));
                allLevels.set(levelConfig.displayTileZoom, tileMap);
                return;
            }

            const tileCountsMap = createAggregatedTileMap(sourceTiles, SOURCE_TILE_ZOOM, levelConfig.displayTileZoom);
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

    const aggregatedDownloadedTiles = useMemo(() => createQuantileOpacityMap(downloaded), [downloaded]);
    const aggregatedGoodNegatives = useMemo(() => createQuantileOpacityMap(goodNegatives), [goodNegatives]);
    const aggregatedDiscoveries = useMemo(() => createQuantileOpacityMap(discoveries), [discoveries]);

    const aggregatedPositiveLabels = useMemo(() => {
        const allLevels = new Map<number, Set<string>>();
        AGGREGATION_LEVELS.forEach(levelConfig => {
            const tileMap = createAggregatedTileMap(positiveLabels, SOURCE_TILE_ZOOM, levelConfig.displayTileZoom);
            allLevels.set(levelConfig.displayTileZoom, new Set(tileMap.keys()));
        });
        return allLevels;
    }, [positiveLabels]);


    const reportRenderCounts = useCallback(() => {
        onRenderCountsChange({
            orange: renderedOrange.current.size,
            selected: renderedSelected.current.size,
            downloading: renderedDownloading.current.size,
            goodNegatives: renderedGoodNegatives.current.size,
            discoveries: renderedDiscoveries.current.size,
            positiveLabels: renderedPositiveLabels.current.size,
        });
    }, [onRenderCountsChange]);

    const drawOrangeTiles = useCallback(() => {
        if (!leafletMap || !showExistingTiles) {
            if (renderedOrange.current.size > 0 || orangeLayer.getLayers().length > 0) {
                orangeLayer.clearLayers();
                renderedOrange.current.clear();
                lastOrangeDisplayZoom.current = null;
                reportRenderCounts();
            }
            return;
        }

        const currentMapZoom = leafletMap.getZoom() ?? SOURCE_TILE_ZOOM;
        let activeConfig = AGGREGATION_LEVELS[AGGREGATION_LEVELS.length - 1];
        for (let i = 0; i < AGGREGATION_LEVELS.length; i++) {
            if (currentMapZoom < AGGREGATION_LEVELS[i].mapZoomThreshold) break;
            activeConfig = AGGREGATION_LEVELS[i];
            if (i < AGGREGATION_LEVELS.length - 1 && currentMapZoom < AGGREGATION_LEVELS[i + 1].mapZoomThreshold) break;
        }

        const {displayTileZoom, padFactor} = activeConfig;
        const tileData = aggregatedDownloadedTiles.get(displayTileZoom);
        if (!tileData) return;

        if (lastOrangeDisplayZoom.current !== displayTileZoom) {
            orangeLayer.clearLayers();
            renderedOrange.current.clear();
            lastOrangeDisplayZoom.current = displayTileZoom;
        }

        let style: TileStyle | ((key: string, opacity: number) => TileStyle);
        let tiles: Map<string, number> | Set<string>;

        if (displayTileZoom === SOURCE_TILE_ZOOM) {
            style = {color: "#ff8c00", weight: 1, opacity: 0.8, fillOpacity: 0.5};
            tiles = new Set(tileData.keys());
        } else {
            tiles = tileData;
            style = (_key: string, opacity: number): TileStyle => {
                return {
                    color: "#ff8c00", weight: 1, opacity: 0.8,
                    fillColor: "#ff8c00",
                    fillOpacity: opacity,
                };
            };
        }

        drawTiles(leafletMap, orangeLayer, tiles, renderedOrange.current,
            style, orangeRenderer, padFactor, displayTileZoom
        );
        reportRenderCounts();
    }, [leafletMap, showExistingTiles, aggregatedDownloadedTiles, orangeLayer, orangeRenderer, reportRenderCounts]);


    const drawGoodNegativeTiles = useCallback(() => {
        if (!leafletMap || !showGoodNegatives) {
            if (renderedGoodNegatives.current.size > 0 || goodNegativesLayer.getLayers().length > 0) {
                goodNegativesLayer.clearLayers();
                renderedGoodNegatives.current.clear();
                lastGoodNegativesDisplayZoom.current = null;
                reportRenderCounts();
            }
            return;
        }

        const currentMapZoom = leafletMap.getZoom() ?? SOURCE_TILE_ZOOM;
        let activeConfig = AGGREGATION_LEVELS[AGGREGATION_LEVELS.length - 1];
        for (let i = 0; i < AGGREGATION_LEVELS.length; i++) {
            if (currentMapZoom < AGGREGATION_LEVELS[i].mapZoomThreshold) break;
            activeConfig = AGGREGATION_LEVELS[i];
            if (i < AGGREGATION_LEVELS.length - 1 && currentMapZoom < AGGREGATION_LEVELS[i + 1].mapZoomThreshold) break;
        }

        const {displayTileZoom, padFactor: goodNegativePad} = activeConfig;
        const tileData = aggregatedGoodNegatives.get(displayTileZoom);
        if (!tileData) return;

        if (lastGoodNegativesDisplayZoom.current !== displayTileZoom) {
            goodNegativesLayer.clearLayers();
            renderedGoodNegatives.current.clear();
            lastGoodNegativesDisplayZoom.current = displayTileZoom;
        }

        let style: TileStyle | ((key: string, opacity: number) => TileStyle);
        let tiles: Map<string, number> | Set<string>;

        if (displayTileZoom === SOURCE_TILE_ZOOM) {
            style = {color: "#FF0000", weight: 1, opacity: 1, fillOpacity: 1};
            tiles = new Set(tileData.keys());
        } else {
            tiles = tileData;
            style = (_key: string, opacity: number): TileStyle => ({
                color: "#FF0000", weight: 1, opacity: 0.8,
                fillColor: "#FF0000",
                fillOpacity: opacity,
            });
        }

        drawTiles(leafletMap, goodNegativesLayer, tiles, renderedGoodNegatives.current, style, goodNegativesRenderer, goodNegativePad, displayTileZoom);
        reportRenderCounts();

    }, [leafletMap, showGoodNegatives, aggregatedGoodNegatives, goodNegativesLayer, goodNegativesRenderer, reportRenderCounts]);

    const drawDiscoveryTiles = useCallback(() => {
        if (!leafletMap || !showDiscoveries) {
            if (renderedDiscoveries.current.size > 0 || discoveriesLayer.getLayers().length > 0) {
                discoveriesLayer.clearLayers();
                renderedDiscoveries.current.clear();
                lastDiscoveriesDisplayZoom.current = null;
                reportRenderCounts();
            }
            return;
        }

        const currentMapZoom = leafletMap.getZoom() ?? SOURCE_TILE_ZOOM;
        let activeConfig = AGGREGATION_LEVELS[AGGREGATION_LEVELS.length - 1];
        for (let i = 0; i < AGGREGATION_LEVELS.length; i++) {
            if (currentMapZoom < AGGREGATION_LEVELS[i].mapZoomThreshold) break;
            activeConfig = AGGREGATION_LEVELS[i];
            if (i < AGGREGATION_LEVELS.length - 1 && currentMapZoom < AGGREGATION_LEVELS[i + 1].mapZoomThreshold) break;
        }

        const {displayTileZoom, padFactor: discoveryPad} = activeConfig;
        const tileData = aggregatedDiscoveries.get(displayTileZoom);
        if (!tileData) return;

        if (lastDiscoveriesDisplayZoom.current !== displayTileZoom) {
            discoveriesLayer.clearLayers();
            renderedDiscoveries.current.clear();
            lastDiscoveriesDisplayZoom.current = displayTileZoom;
        }

        let style: TileStyle | ((key: string, opacity: number) => TileStyle);
        let tiles: Map<string, number> | Set<string>;

        if (displayTileZoom === SOURCE_TILE_ZOOM) {
            style = {color: discoveriesColor, weight: 1, opacity: 1, fillOpacity: 1};
            tiles = new Set(tileData.keys());
        } else {
            tiles = tileData;
            style = (_key: string, opacity: number): TileStyle => ({
                color: discoveriesColor, weight: 1, opacity: 0.8,
                fillColor: discoveriesColor,
                fillOpacity: opacity,
            });
        }

        drawTiles(leafletMap, discoveriesLayer, tiles, renderedDiscoveries.current, style, discoveriesRenderer, discoveryPad, displayTileZoom);
        reportRenderCounts();

    }, [leafletMap, showDiscoveries, aggregatedDiscoveries, discoveriesLayer, discoveriesRenderer, reportRenderCounts, discoveriesColor]);

    const drawPositiveLabelTiles = useCallback(() => {
        if (!leafletMap || !labelsAggregatedLayer) return;

        const currentMapZoom = leafletMap.getZoom() ?? SOURCE_TILE_ZOOM;
        const shouldShowAggregated = showLabels && currentMapZoom < zoomThreshold;

        if (shouldShowAggregated) {
            if (!leafletMap.hasLayer(labelsAggregatedLayer)) {
                leafletMap.addLayer(labelsAggregatedLayer);
            }
        } else {
            if (leafletMap.hasLayer(labelsAggregatedLayer)) {
                leafletMap.removeLayer(labelsAggregatedLayer);
            }
            if (renderedPositiveLabels.current.size > 0) {
                labelsAggregatedLayer.clearLayers();
                renderedPositiveLabels.current.clear();
            }
            reportRenderCounts();
            return;
        }

        let activeConfig = AGGREGATION_LEVELS[AGGREGATION_LEVELS.length - 1];
        for (let i = 0; i < AGGREGATION_LEVELS.length; i++) {
            if (currentMapZoom < AGGREGATION_LEVELS[i].mapZoomThreshold) break;
            activeConfig = AGGREGATION_LEVELS[i];
            if (i < AGGREGATION_LEVELS.length - 1 && currentMapZoom < AGGREGATION_LEVELS[i + 1].mapZoomThreshold) break;
        }

        const displayTileZoom = activeConfig.displayTileZoom;
        if (lastPositiveLabelsDisplayZoom.current !== displayTileZoom) {
            labelsAggregatedLayer.clearLayers();
            renderedPositiveLabels.current.clear();
            lastPositiveLabelsDisplayZoom.current = displayTileZoom;
        }

        const pad = activeConfig.padFactor;
        const tilesToDraw = aggregatedPositiveLabels.get(displayTileZoom) || new Set<string>();
        const style = {color: labelsColor, weight: 1, opacity: 0.9, fillOpacity: labelsOpacity};
        drawTiles(leafletMap, labelsAggregatedLayer, tilesToDraw, renderedPositiveLabels.current, style, labelsAggregatedRenderer, pad, displayTileZoom);
        reportRenderCounts();
    }, [leafletMap, showLabels, aggregatedPositiveLabels, labelsAggregatedLayer, labelsAggregatedRenderer, reportRenderCounts, labelsColor, labelsOpacity, zoomThreshold]);


    useEffect(() => {
        drawOrangeTiles();
    }, [drawOrangeTiles]);

    useEffect(() => {
        if (!leafletMap) return;
        const throttledRefresh = throttle(drawOrangeTiles, 150);
        leafletMap.on("moveend", throttledRefresh);
        leafletMap.on("zoomend", throttledRefresh);
        drawOrangeTiles();
        return () => {
            leafletMap.off("moveend", throttledRefresh).off("zoomend", throttledRefresh);
            (throttledRefresh as { cancel: () => void }).cancel();
        };
    }, [leafletMap, drawOrangeTiles]);

    useEffect(() => {
        drawTiles(leafletMap, downloadingLayer, downloading, renderedDownloading.current,
            {color: "#fbbf24", weight: 2, opacity: 0.9, fillOpacity: 0.6, className: "animate-pulse"},
            downloadingRenderer, 0.2, SOURCE_TILE_ZOOM
        );
        reportRenderCounts();
    }, [downloading, downloadingLayer, downloadingRenderer, leafletMap, reportRenderCounts]);

    useEffect(() => {
        const style = {
            color: mode === "download" ? "#00cc66" : "#4169e1",
            weight: 1, opacity: 0.6, fillOpacity: mode === "download" ? 0.3 : 0.4
        };
        drawTiles(leafletMap, selectedLayer, selected, renderedSelected.current, style, selectedRenderer, 0.2, SOURCE_TILE_ZOOM);
        reportRenderCounts();
    }, [mode, selected, selectedLayer, selectedRenderer, leafletMap, reportRenderCounts]);


    useEffect(() => {
        drawGoodNegativeTiles();
    }, [drawGoodNegativeTiles]);

    useEffect(() => {
        if (!leafletMap) return;
        const throttledRefresh = throttle(drawGoodNegativeTiles, 150);
        leafletMap.on("moveend", throttledRefresh);
        leafletMap.on("zoomend", throttledRefresh);
        drawGoodNegativeTiles();
        return () => {
            leafletMap.off("moveend", throttledRefresh).off("zoomend", throttledRefresh);
            (throttledRefresh as { cancel: () => void }).cancel();
        };
    }, [leafletMap, drawGoodNegativeTiles]);

    useEffect(() => {
        drawDiscoveryTiles();
    }, [drawDiscoveryTiles]);

    useEffect(() => {
        if (!leafletMap) return;
        const throttledRefresh = throttle(drawDiscoveryTiles, 150);
        leafletMap.on("moveend", throttledRefresh);
        leafletMap.on("zoomend", throttledRefresh);
        drawDiscoveryTiles();
        return () => {
            leafletMap.off("moveend", throttledRefresh).off("zoomend", throttledRefresh);
            (throttledRefresh as { cancel: () => void }).cancel();
        };
    }, [leafletMap, drawDiscoveryTiles]);

    useEffect(() => {
        drawPositiveLabelTiles();
    }, [drawPositiveLabelTiles]);

    useEffect(() => {
        if (!leafletMap) return;
        const throttledRefresh = throttle(drawPositiveLabelTiles, 150);
        leafletMap.on("moveend", throttledRefresh);
        leafletMap.on("zoomend", throttledRefresh);
        drawPositiveLabelTiles();
        return () => {
            leafletMap.off("moveend", throttledRefresh).off("zoomend", throttledRefresh);
            (throttledRefresh as { cancel: () => void }).cancel();
        };
    }, [leafletMap, drawPositiveLabelTiles]);

    useEffect(() => {
        if (renderedSelected.current.size > 0) {
            selectedLayer.clearLayers();
            renderedSelected.current.clear();
            reportRenderCounts();
        }
    }, [mode, selectedLayer, reportRenderCounts]);
}