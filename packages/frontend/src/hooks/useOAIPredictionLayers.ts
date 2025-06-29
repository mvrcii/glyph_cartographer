import {useCallback, useEffect, useRef} from 'react';
import L from 'leaflet';
import throttle from 'lodash/throttle';
import {lat2tile, lon2tile, tile2lat, tile2lon} from '../utils/tileMathUtils.ts';

export interface OAITilePrediction {
    x: number;
    y: number;
    prob: number;
    label: string;
    description?: string;
}

interface UseOaiPredictionLayersProps {
    map: L.Map | null;
    models: string[];
    oaiPredictions: Map<string, Map<string, OAITilePrediction>>;
    visibility: Map<string, boolean>;
    zoomThreshold: number;
    onLoadOaiTiles: (modelName: string) => void;
}

interface OaiLayer extends L.Layer {
    _tileKey?: string;
}

const getBorderColor = (prob: number): string => {
    const p = Math.max(0, Math.min(1, prob));
    const r = p < 0.5 ? 255 : Math.round(510 * (1 - p));
    const g = p > 0.5 ? 255 : Math.round(510 * p);
    const toHex = (c: number) => c.toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}00`;
};

const createLabelIcon = (prediction: OAITilePrediction, color: string): L.DivIcon => {
    const probability = prediction.prob.toFixed(2);
    return L.divIcon({
        html: `
            <div style="
                background: rgba(0, 0, 0, 0.75);
                border: 1px solid ${color};
                border-radius: 4px;
                padding: 2px 4px;
                font-size: 12px;
                font-weight: 600;
                color: white;
                box-shadow: 0 1px 2px rgba(0,0,0,0.3);
                /* REMOVED: white-space: nowrap; */
                /* ADDED: max-width and word-wrap */
                max-width: 80px;
                word-wrap: break-word; /* Helps break long words if needed */
                text-align: center;
                backdrop-filter: blur(1px);
            ">
                <div style="line-height: 1.1;">
                    <div style="font-size: 10px; opacity: 0.9; color: ${color};">${prediction.label}</div>
                    <div style="color: white; font-size: 10px;">${probability}</div>
                </div>
            </div>
        `,
        className: 'oai-prediction-label',
        // UPDATED: Accommodate a larger, potentially two-line box
        iconSize: [88, 36], // Increased width (80px + padding/border) and height
        iconAnchor: [44, 18]  // Half of iconSize to keep it centered
    });
};

export function useOaiPredictionLayers({
                                           map,
                                           models,
                                           oaiPredictions,
                                           visibility,
                                           zoomThreshold,
                                           onLoadOaiTiles
                                       }: UseOaiPredictionLayersProps) {
    const layerGroups = useRef(new Map<string, L.LayerGroup>());
    const renderedTiles = useRef(new Map<string, Set<string>>());
    const Z = 17;

    useEffect(() => {
        if (!map) return;

        // Clean up removed models
        layerGroups.current.forEach((layer, modelName) => {
            if (!models.includes(modelName)) {
                map.removeLayer(layer);
                layerGroups.current.delete(modelName);
                renderedTiles.current.delete(modelName);
            }
        });

        // Initialize new models
        models.forEach((modelName) => {
            if (!layerGroups.current.has(modelName)) {
                const paneName = `predictionOaiPane_${modelName}`;
                if (!map.getPane(paneName)) {
                    const pane = map.createPane(paneName);
                    pane.style.zIndex = '445';
                }

                const layerGroup = L.layerGroup([], {pane: paneName});
                layerGroups.current.set(modelName, layerGroup);
                renderedTiles.current.set(modelName, new Set());
                map.addLayer(layerGroup);
            }
        });
    }, [map, models]);

    const renderAllLayers = useCallback(() => {
        if (!map) return;

        const currentZoom = map.getZoom();
        const shouldRender = currentZoom >= zoomThreshold;

        models.forEach(modelName => {
            const isVisible = visibility.get(modelName) ?? false;
            const layerGroup = layerGroups.current.get(modelName);


            if (!layerGroup || !isVisible || !shouldRender) {
                layerGroup?.clearLayers();
                renderedTiles.current.get(modelName)?.clear();
                return;
            }

            console.log("rendering model", modelName)

            const modelPredictions = oaiPredictions.get(modelName);
            if (!modelPredictions) return;

            console.log("modelPredictions", modelPredictions)

            const rendered = renderedTiles.current.get(modelName);
            if (!rendered) return;

            const viewBounds = map.getBounds().pad(0.5);
            const xMin = lon2tile(viewBounds.getWest(), Z);
            const xMax = lon2tile(viewBounds.getEast(), Z);
            const yMin = lat2tile(viewBounds.getNorth(), Z);
            const yMax = lat2tile(viewBounds.getSouth(), Z);

            // Remove out-of-bounds layers
            layerGroup.eachLayer(layer => {
                const key = (layer as OaiLayer)._tileKey;
                if (key) {
                    const [x, y] = key.split(',').map(Number);
                    if (x < xMin || x > xMax || y < yMin || y > yMax || !modelPredictions.has(key)) {
                        layerGroup.removeLayer(layer);
                        rendered.delete(key);
                    }
                }
            });

            // Add new tiles in view
            for (const [tileKey, prediction] of modelPredictions.entries()) {
                if (!rendered.has(tileKey)) {
                    const [x, y] = tileKey.split(',').map(Number);
                    if (x >= xMin && x <= xMax && y >= yMin && y <= yMax) {
                        console.log(`[OAI DEBUG] Rendering tile: ${tileKey} for model ${modelName}`);

                        const bounds = L.latLngBounds(
                            [tile2lat(y + 1, Z), tile2lon(x, Z)],
                            [tile2lat(y, Z), tile2lon(x + 1, Z)]
                        );
                        const borderColor = getBorderColor(prediction.prob);

                        // Create border rectangle
                        const border: OaiLayer = L.rectangle(bounds, {
                            color: borderColor,
                            weight: 4,
                            opacity: 0.4,
                            fill: false,
                            interactive: false,
                            pane: `predictionOaiPane_${modelName}`
                        });
                        border._tileKey = tileKey;
                        layerGroup.addLayer(border);

                        // Create label
                        const labelIcon = createLabelIcon(prediction, borderColor);
                        const labelMarker: OaiLayer = L.marker(bounds.getCenter(), {
                            icon: labelIcon,
                            interactive: false,
                            pane: `predictionOaiPane_${modelName}`
                        });
                        labelMarker._tileKey = tileKey;
                        layerGroup.addLayer(labelMarker);

                        rendered.add(tileKey);
                    }
                }
            }
        });
    }, [map, models, visibility, oaiPredictions, zoomThreshold, onLoadOaiTiles]);

    useEffect(() => {
        if (!map) return;

        const throttledRender = throttle(renderAllLayers, 150);
        renderAllLayers();

        map.on('zoomend moveend', throttledRender);
        return () => {
            map.off('zoomend moveend', throttledRender);
            throttledRender.cancel();
        };
    }, [map, renderAllLayers]);
}