import {useCallback, useEffect, useRef, useState} from 'react';
import L, {type LatLngLiteral} from 'leaflet';
import throttle from 'lodash/throttle';
import {lat2tile, lon2tile, tile2lat, tile2lon} from '../utils/tileMathUtils.ts';

/**
 * Internal helper: extend the Leaflet ImageOverlay with a tile-key property.
 */
interface ImageOverlayWithKey extends L.ImageOverlay {
    _tileKey?: string;
}

export interface UseLabelMaskLayerProps {
    map: L.Map | null;
    positiveLabels: Set<string>;
    showLabels: boolean;
    labelsColor: string;
    labelsOpacity: number;
    labelMaskVersion: number;
    zoomThreshold: number;
    imagePaneName: string;
    outlinePaneName: string;
}

/**
 * Convert a greyscale mask PNG into a solid-color PNG with alpha preserved.
 */
function makeTintedPng(img: HTMLImageElement, hexColour: string): string {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const [r, g, b] = hexColour.match(/\w\w/g)!.map(c => parseInt(c, 16));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);

    const data = ctx.getImageData(0, 0, w, h);
    for (let i = 0; i < data.data.length; i += 4) {
        const alpha = data.data[i]; // greyscale mask → red channel
        data.data[i] = r;
        data.data[i + 1] = g;
        data.data[i + 2] = b;
        data.data[i + 3] = alpha;
    }
    ctx.putImageData(data, 0, 0);
    return canvas.toDataURL('image/png');
}

/**
 * React hook: adds two Leaflet overlay panes – a tinted-PNG image layer and an
 * outline canvas – that show labelled tiles.  All map interaction happens
 * through this hook: add/remove overlays when the viewport changes, refresh
 * them when the mask version bumps, and re-tint them when the colour picker
 * changes, all without ever flashing the underlying basemap.
 */
export function useLabelMaskLayer({
                                      map,
                                      positiveLabels,
                                      showLabels,
                                      labelsColor,
                                      labelsOpacity,
                                      labelMaskVersion,
                                      zoomThreshold,
                                      imagePaneName,
                                      outlinePaneName,
                                  }: UseLabelMaskLayerProps): void {
    const imageLayerGroup = useRef<L.LayerGroup | null>(null);
    const outlineLayerGroup = useRef<L.LayerGroup | null>(null);
    const renderedTiles = useRef<Set<string>>(new Set());
    const outlineRenderer = useRef<L.Canvas | null>(null);
    const workerRef = useRef<Worker | null>(null);
    const prevPositiveLabelsRef = useRef<Set<string>>(new Set());
    const [outlines, setOutlines] = useState<L.LatLng[][]>([]);

    /** TMS zoom level – fixed in this codebase. */
    const Z = 17;

    // --- Layer & Worker Bootstrap ---
    useEffect(() => {
        if (!map) return;

        imageLayerGroup.current = L.layerGroup([], {pane: imagePaneName});
        outlineLayerGroup.current = L.layerGroup([], {pane: outlinePaneName});
        outlineRenderer.current = L.canvas({pane: outlinePaneName});

        map.addLayer(imageLayerGroup.current);
        map.addLayer(outlineLayerGroup.current);

        // Web-worker: receive outline polygon coordinates
        workerRef.current = new Worker('/outline.worker.js');
        workerRef.current.onmessage = (event: MessageEvent<LatLngLiteral[][]>) => {
            const polys = event.data.map(poly => poly.map(p => L.latLng(p.lat, p.lng)));
            setOutlines(polys);
        };

        return () => {
            workerRef.current?.terminate();
            if (imageLayerGroup.current) map.removeLayer(imageLayerGroup.current);
            if (outlineLayerGroup.current) map.removeLayer(outlineLayerGroup.current);
        };
    }, [map, imagePaneName, outlinePaneName]);

    // --- Send Label Set to Worker ---
    useEffect(() => {
        if (!workerRef.current || positiveLabels === prevPositiveLabelsRef.current) return;
        prevPositiveLabelsRef.current = positiveLabels;
        workerRef.current.postMessage(Array.from(positiveLabels));
    }, [positiveLabels]);

    // --- Draw / Recolor Polygon Outlines ---
    useEffect(() => {
        const layer = outlineLayerGroup.current;
        const renderer = outlineRenderer.current;
        if (!layer || !renderer) return;

        layer.clearLayers();
        const outlinePolygons = outlines.map(points =>
            L.polygon(points, {
                color: labelsColor,
                weight: 2,
                opacity: 0.8,
                fill: false,
                interactive: false,
                renderer,
            }),
        );
        outlinePolygons.forEach(p => layer.addLayer(p));
    }, [outlines, labelsColor]);

    // Live-update outline colour when the picker changes
    useEffect(() => {
        if (!outlineLayerGroup.current) return;
        outlineLayerGroup.current.eachLayer(layer => {
            if ('setStyle' in layer) (layer as L.Path).setStyle({color: labelsColor});
        });
    }, [labelsColor]);

    // --- Re-tint Existing Image Overlays ---
    useEffect(() => {
        if (!imageLayerGroup.current) return;
        imageLayerGroup.current.eachLayer(layer => {
            const img = (layer as L.ImageOverlay).getElement() as HTMLImageElement | null;
            if (!img || !img.dataset.originalSrc) return;

            const src = img.dataset.originalSrc;
            const tmp = new Image();
            tmp.onload = () => {
                img.src = makeTintedPng(tmp, labelsColor);
            };
            tmp.src = src;
        });
    }, [labelsColor]);

    // --- Pane Opacity from Slider ---
    useEffect(() => {
        if (!map) return;
        const pane = map.getPane(imagePaneName);
        if (pane) pane.style.opacity = String(labelsOpacity);
    }, [map, imagePaneName, labelsOpacity]);

    // --- Core Render Function ---
    const renderLayer = useCallback(() => {
        if (!map || !imageLayerGroup.current || !outlineLayerGroup.current) return;

        // 1. Show / hide whole layer depending on zoom & toggle
        const currentZoom = map.getZoom();
        const shouldShow = showLabels && currentZoom >= zoomThreshold;

        if (shouldShow) {
            if (!map.hasLayer(imageLayerGroup.current)) map.addLayer(imageLayerGroup.current);
            if (!map.hasLayer(outlineLayerGroup.current)) map.addLayer(outlineLayerGroup.current);
        } else {
            if (map.hasLayer(imageLayerGroup.current)) map.removeLayer(imageLayerGroup.current);
            if (map.hasLayer(outlineLayerGroup.current)) map.removeLayer(outlineLayerGroup.current);
            return;
        }

        // 2. Calculate visible tile window (slightly padded)
        const viewBounds = map.getBounds().pad(0.5);
        const xMin = lon2tile(viewBounds.getWest(), Z);
        const xMax = lon2tile(viewBounds.getEast(), Z);
        const yMin = lat2tile(viewBounds.getNorth(), Z);
        const yMax = lat2tile(viewBounds.getSouth(), Z);

        // 3. Remove overlays that scrolled out or are no longer labelled
        imageLayerGroup.current.eachLayer(layer => {
            const ov = layer as ImageOverlayWithKey;
            const key = ov._tileKey;
            if (!key) return;
            const [x, y] = key.split(',').map(Number);
            const outOfView = x < xMin || x > xMax || y < yMin || y > yMax;
            const deleted = !positiveLabels.has(key);
            if (outOfView || deleted) {
                imageLayerGroup.current!.removeLayer(ov);
                renderedTiles.current.delete(key);
            }
        });

        // 4. Add overlays for any positive tile now in view but not yet rendered
        positiveLabels.forEach(tileKey => {
            if (renderedTiles.current.has(tileKey)) return; // Already on screen
            const [x, y] = tileKey.split(',').map(Number);
            if (x < xMin || x > xMax || y < yMin || y > yMax) return; // Outside viewport

            const bounds = L.latLngBounds(
                [tile2lat(y + 1, Z), tile2lon(x, Z)],
                [tile2lat(y, Z), tile2lon(x + 1, Z)],
            );

            const url = `/api/labels/image/${Z}/${x}/${y}.png?v=${labelMaskVersion}`;
            const overlay: ImageOverlayWithKey = L.imageOverlay(url, bounds, {
                pane: imagePaneName,
                className: 'label-mask-image',
                crossOrigin: 'anonymous',
            });
            overlay._tileKey = tileKey;

            overlay.once('load', () => {
                const img = overlay.getElement() as HTMLImageElement | null;
                if (!img) return;
                img.dataset.originalSrc = img.src; // Remember greyscale for recoloring
                img.src = makeTintedPng(img, labelsColor);
            });

            imageLayerGroup.current!.addLayer(overlay);
            renderedTiles.current.add(tileKey);
        });
    }, [map, showLabels, positiveLabels, labelMaskVersion, labelsColor, zoomThreshold]);

    // --- Call Render on Move / Zoom (Throttled) ---
    useEffect(() => {
        if (!map) return;
        const throttled = throttle(renderLayer, 150, {leading: false, trailing: true});
        renderLayer(); // Initial draw
        map.on('zoomend moveend', throttled);
        return () => {
            map.off('zoomend moveend', throttled);
            throttled.cancel();
        };
    }, [map, renderLayer]);

    // --- Refresh Tiles when Version Bumps ---
    useEffect(() => {
        if (!imageLayerGroup.current || labelMaskVersion === 1) return;

        imageLayerGroup.current.eachLayer(layer => {
            const overlay = layer as ImageOverlayWithKey;
            const key = overlay._tileKey;
            if (!key) return;

            const displayedImg = overlay.getElement() as HTMLImageElement | null;
            if (!displayedImg) return;

            const [x, y] = key.split(',').map(Number);
            const newUrl = `/api/labels/image/${Z}/${x}/${y}.png?v=${labelMaskVersion}`;

            // Flicker-Free Loading Pattern:
            // 1. Create a temporary, in-memory image to load the new mask.
            const tempImg = new Image();
            tempImg.crossOrigin = 'anonymous';

            // 2. Define what happens once the new mask is loaded.
            tempImg.onload = () => {
                // 3. Tint the newly loaded image data.
                const tintedDataUrl = makeTintedPng(tempImg, labelsColor);
                // 4. Update the dataset for future color changes.
                displayedImg.dataset.originalSrc = newUrl;
                // 5. Atomically swap the 'src' of the visible image.
                displayedImg.src = tintedDataUrl;
            };

            // 6. Start the background loading process.
            tempImg.src = newUrl;
        });

        // Ensure any brand-new tiles are added to the map.
        renderLayer();
    }, [labelMaskVersion]);
}