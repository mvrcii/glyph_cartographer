import {useCallback, useEffect, useRef, useState} from 'react';
import L, {type LatLngLiteral} from 'leaflet';
import throttle from 'lodash/throttle';
import {lat2tile, lon2tile, tile2lat, tile2lon} from '../utils/tileMathUtils.ts';

interface ImageOverlayWithKey extends L.ImageOverlay {
    _tileKey?: string;
}

interface UseCustomImageryLayerProps {
    map: L.Map | null;
    downloaded: Set<string>;
    orangeLayer: L.LayerGroup;
    showExistingTiles: boolean;
    zoomThreshold: number;
    imagePaneName: string;
    outlinePaneName: string;
}

export function useSatelliteImageLayer({
                                           map,
                                           downloaded,
                                           orangeLayer,
                                           showExistingTiles,
                                           zoomThreshold,
                                           imagePaneName,
                                           outlinePaneName,
                                       }: UseCustomImageryLayerProps): void {
    const imageryLayerGroup = useRef<L.LayerGroup | null>(null);
    const outlineLayerGroup = useRef<L.LayerGroup | null>(null);
    const renderedImages = useRef<Set<string>>(new Set());
    const workerRef = useRef<Worker | null>(null);
    const prevTilesRef = useRef<Set<string>>(new Set());
    const outlineRenderer = useRef<L.Canvas | null>(null);
    const [outlines, setOutlines] = useState<L.LatLng[][]>([]);
    const Z = 17;

    useEffect(() => {
        if (!map) return;

        // Initialize layers on the panes created by MapCanvas
        imageryLayerGroup.current = L.layerGroup([], {pane: imagePaneName});
        outlineLayerGroup.current = L.layerGroup([], {pane: outlinePaneName});
        outlineRenderer.current = L.canvas({pane: outlinePaneName});

        workerRef.current = new Worker('/outline.worker.js');
        workerRef.current.onmessage = (event: MessageEvent<LatLngLiteral[][]>) => {
            const latLngPolygons = event.data.map(poly => poly.map(p => L.latLng(p.lat, p.lng)));
            setOutlines(latLngPolygons);
        };

        return () => {
            workerRef.current?.terminate();
        };
    }, [map, imagePaneName, outlinePaneName]);

        // This effect now sends the data to the worker instead of calculating it directly
    useEffect(() => {
        if (!workerRef.current) return;

        if (downloaded.size === prevTilesRef.current.size) {
            let identical = true;
            for (const k of downloaded) {
                if (!prevTilesRef.current.has(k)) {
                    identical = false;
                    break;
                }
            }
            if (identical) return;
        }

        prevTilesRef.current = new Set(downloaded);

        if (downloaded.size === 0) {
            setOutlines([]);
        } else {
            workerRef.current.postMessage(Array.from(downloaded));
        }
    }, [downloaded]);

    // This effect draws the outlines when they are received from the worker
    useEffect(() => {
        const layer = outlineLayerGroup.current;
        if (!layer) return;

        const canvasRenderer = outlineRenderer.current;
        if (!canvasRenderer) return;

        layer.clearLayers();

        const outlinePolygons = outlines.map(points =>
            L.polygon(points, {
                color: '#00FF00',
                weight: 2,
                opacity: 0.8,
                fill: false,
                interactive: false,
                renderer: canvasRenderer
            }));
        outlinePolygons.forEach(p => layer.addLayer(p));
    }, [outlines]);

    const renderVisibleImagery = useCallback(() => {
        if (!map || !imageryLayerGroup.current || !outlineLayerGroup.current) return;

        const currentZoom = map.getZoom();
        const shouldShowImagery = showExistingTiles && currentZoom >= zoomThreshold;

        // This logic remains the same, but now controls layers on centrally-managed panes
        if (shouldShowImagery) {
            if (!map.hasLayer(imageryLayerGroup.current)) map.addLayer(imageryLayerGroup.current);
            if (!map.hasLayer(outlineLayerGroup.current)) map.addLayer(outlineLayerGroup.current);
            if (map.hasLayer(orangeLayer)) map.removeLayer(orangeLayer);
        } else {
            if (map.hasLayer(imageryLayerGroup.current)) map.removeLayer(imageryLayerGroup.current);
            if (map.hasLayer(outlineLayerGroup.current)) map.removeLayer(outlineLayerGroup.current);
            if (showExistingTiles && !map.hasLayer(orangeLayer)) map.addLayer(orangeLayer);
            else if (!showExistingTiles && map.hasLayer(orangeLayer)) map.removeLayer(orangeLayer);
            return;
        }

        const viewBounds = map.getBounds().pad(0.8);
        const xMin = lon2tile(viewBounds.getWest(), Z);
        const xMax = lon2tile(viewBounds.getEast(), Z);
        const yMin = lat2tile(viewBounds.getNorth(), Z);
        const yMax = lat2tile(viewBounds.getSouth(), Z);

        const layersToRemove: ImageOverlayWithKey[] = [];
        imageryLayerGroup.current.eachLayer(layer => {
            const imageOverlay = layer as ImageOverlayWithKey;
            const key = imageOverlay._tileKey;
            if (key) {
                const [x, y] = key.split(',').map(Number);
                if (x < xMin || x > xMax || y < yMin || y > yMax) layersToRemove.push(imageOverlay);
            }
        });
        layersToRemove.forEach(layer => {
            if (layer._tileKey) renderedImages.current.delete(layer._tileKey);
            imageryLayerGroup.current?.removeLayer(layer);
        });

        for (let x = xMin; x <= xMax; x++) {
            for (let y = yMin; y <= yMax; y++) {
                const key = `${x},${y}`;
                if (downloaded.has(key) && !renderedImages.current.has(key)) {
                    const bounds = L.latLngBounds([tile2lat(y + 1, Z), tile2lon(x, Z)], [tile2lat(y, Z), tile2lon(x + 1, Z)]);
                    const imageUrl = `/api/tiles/satellite/${Z}/${x}/${y}.png`;
                    const imageOverlay: ImageOverlayWithKey = L.imageOverlay(imageUrl, bounds);
                    imageOverlay._tileKey = key;
                    imageryLayerGroup.current.addLayer(imageOverlay);
                    renderedImages.current.add(key);
                }
            }
        }
    }, [map, downloaded, orangeLayer, showExistingTiles, zoomThreshold]);

    // Effect to handle all visibility changes
    useEffect(() => {
        if (!map) return;
        const throttledRender = throttle(renderVisibleImagery, 150);
        renderVisibleImagery();
        map.on('zoomend moveend', throttledRender);
        return () => {
            map.off('zoomend moveend', throttledRender);
            if (imageryLayerGroup.current) {
                imageryLayerGroup.current.clearLayers();
                renderedImages.current.clear();
            }
        };
    }, [map, renderVisibleImagery]);
}