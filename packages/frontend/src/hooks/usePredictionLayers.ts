import {useCallback, useEffect, useRef} from 'react';
import L from 'leaflet';
import throttle from 'lodash/throttle';
import {drawTiles} from '../utils/tileDrawingUtils.ts';
import {lat2tile, lon2tile, tile2lat, tile2lon} from '../utils/tileMathUtils.ts';

interface ImageOverlayWithKey extends L.ImageOverlay {
    _tileKey?: string;
}

interface UsePredictionLayersProps {
    map: L.Map | null;
    models: string[];
    allTiles: Map<string, Set<string>>;
    visibility: Map<string, boolean>;
    opacities: Map<string, number>;
    onLoadTiles: (modelName: string) => void;
    predictionTileVersions: Map<string, number>;
    zoomThreshold: number;
}

export function usePredictionLayers({
                                        map,
                                        models,
                                        allTiles,
                                        visibility,
                                        opacities,
                                        onLoadTiles,
                                        predictionTileVersions,
                                        zoomThreshold
                                    }: UsePredictionLayersProps) {
    const layerGroups = useRef(new Map<string, { grid: L.LayerGroup, images: L.LayerGroup }>());
    const renderedGridTiles = useRef(new Map<string, Set<string>>());
    const renderedImageTiles = useRef(new Map<string, Set<string>>());
    const renderedImageVersions = useRef(new Map<string, Map<string, number>>());
    const Z = 17; // The zoom level of the tile data itself

    // Effect to create/destroy layer groups as models appear/disappear
    useEffect(() => {
        if (!map) return;

        // Clean up layers for models that are no longer present
        layerGroups.current.forEach((layers, modelName) => {
            if (!models.includes(modelName)) {
                map.removeLayer(layers.grid);
                map.removeLayer(layers.images);
                layerGroups.current.delete(modelName);
                renderedGridTiles.current.delete(modelName);
                renderedImageTiles.current.delete(modelName);
                renderedImageVersions.current.delete(modelName); // Correctly cleans up all versions for the model
            }
        });

        // Create layers for new models
        models.forEach((modelName) => {
            if (!layerGroups.current.has(modelName)) {
                const gridPaneName = `predictionGrid_${modelName}`;
                const imagePaneName = `predictionImage_${modelName}`;

                const gridPane = map.createPane(gridPaneName);
                gridPane.style.zIndex = '425';
                const imagePane = map.createPane(imagePaneName);
                imagePane.style.zIndex = '435';

                const gridLayer = L.layerGroup([], {pane: gridPaneName});
                const imageLayer = L.layerGroup([], {pane: imagePaneName});

                layerGroups.current.set(modelName, {grid: gridLayer, images: imageLayer});
                renderedGridTiles.current.set(modelName, new Set());
                renderedImageTiles.current.set(modelName, new Set());
                renderedImageVersions.current.set(modelName, new Map()); // Initialize the nested map for the new model

                map.addLayer(gridLayer);
                map.addLayer(imageLayer);
            }
        });
    }, [map, models]);

    const renderAllLayers = useCallback(() => {
        if (!map) return;

        const currentZoom = map.getZoom();
        const showImages = currentZoom >= zoomThreshold;

        models.forEach(modelName => {
            const isVisible = visibility.get(modelName) ?? false;
            const layers = layerGroups.current.get(modelName);
            if (!layers) return;

            // Clear layers if not visible
            if (!isVisible) {
                layers.grid.clearLayers();
                layers.images.clearLayers();
                renderedGridTiles.current.get(modelName)?.clear();
                renderedImageTiles.current.get(modelName)?.clear();
                return;
            }

            // Get tile data for this model, triggering a fetch if it's missing
            const tiles = allTiles.get(modelName);
            if (!tiles) {
                onLoadTiles(modelName);
                return; // Render will be triggered again when data arrives
            }

            // Toggle between grid and image layers based on zoom
            if (showImages) {
                layers.grid.clearLayers();
                renderedGridTiles.current.get(modelName)?.clear();
                renderImageLayer(modelName, tiles);
            } else {
                layers.images.clearLayers();
                renderedImageTiles.current.get(modelName)?.clear();
                renderGridLayer(modelName, tiles);
            }
        });
    }, [map, models, visibility, allTiles, onLoadTiles, opacities, predictionTileVersions, zoomThreshold]);

    const renderGridLayer = (modelName: string, tiles: Set<string>) => {
        const layers = layerGroups.current.get(modelName);
        const rendered = renderedGridTiles.current.get(modelName);
        if (!map || !layers || !rendered) return;

        const style = {color: "#3388ff", weight: 1, opacity: 0.8, fillOpacity: 0.2};
        drawTiles(map, layers.grid, tiles, rendered, style, null, 0.5, Z);
    };

    const renderImageLayer = (modelName: string, tiles: Set<string>) => {
        const layers = layerGroups.current.get(modelName);
        const rendered = renderedImageTiles.current.get(modelName);
        const modelImageVersions = renderedImageVersions.current.get(modelName);

        if (!map || !layers || !rendered || !modelImageVersions) return;

        const viewBounds = map.getBounds().pad(0.8);
        const xMin = lon2tile(viewBounds.getWest(), Z), xMax = lon2tile(viewBounds.getEast(), Z);
        const yMin = lat2tile(viewBounds.getNorth(), Z), yMax = lat2tile(viewBounds.getSouth(), Z);

        // Remove off-screen or outdated images
        layers.images.eachLayer(l => {
            const key = (l as ImageOverlayWithKey)._tileKey;
            if (key) {
                const [x, y] = key.split(',').map(Number);
                const currentVersion = predictionTileVersions.get(key);
                const renderedVersion = modelImageVersions.get(key);

                if (x < xMin || x > xMax || y < yMin || y > yMax || !tiles.has(key) || (currentVersion && currentVersion !== renderedVersion)) {
                    layers.images.removeLayer(l);
                    rendered.delete(key);
                    modelImageVersions.delete(key);
                }
            }
        });

        // Add new on-screen images
        for (const tileKey of tiles) {
            if (!rendered.has(tileKey)) {
                const [x, y] = tileKey.split(',').map(Number);
                if (x >= xMin && x <= xMax && y >= yMin && y <= yMax) {
                    const bounds = L.latLngBounds([tile2lat(y + 1, Z), tile2lon(x, Z)], [tile2lat(y, Z), tile2lon(x + 1, Z)]);
                    const version = predictionTileVersions.get(tileKey) || 'initial';
                    const imageUrl = `/api/inference/tile/${modelName}/${Z}/${x}/${y}.png?v=${version}`;
                    const imageOverlay: ImageOverlayWithKey = L.imageOverlay(imageUrl, bounds, {
                        pane: layers.images.options.pane as string,
                        opacity: opacities.get(modelName) ?? 0.7
                    });
                    imageOverlay._tileKey = tileKey;
                    layers.images.addLayer(imageOverlay);
                    rendered.add(tileKey);
                    if (typeof version === 'number') {
                        modelImageVersions.set(tileKey, version);
                    }
                }
            }
        }
    };

    // Main effect to handle rendering on map move/zoom and data changes
    useEffect(() => {
        if (!map) return;
        const throttledRender = throttle(renderAllLayers, 150);
        renderAllLayers();
        map.on('zoomend moveend', throttledRender);
        return () => {
            map.off('zoomend moveend', throttledRender);
            (throttledRender as any).cancel();
        };
    }, [map, renderAllLayers]);

    // Effect to handle opacity changes
    useEffect(() => {
        if (!map) return;
        opacities.forEach((opacity, modelName) => {
            const layers = layerGroups.current.get(modelName);
            if (layers) {
                layers.images.eachLayer(l => {
                    (l as L.ImageOverlay).setOpacity(opacity);
                });
            }
        });
    }, [map, opacities]);
}