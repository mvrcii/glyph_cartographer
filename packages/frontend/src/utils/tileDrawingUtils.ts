import L from 'leaflet';
import {lat2tile, lon2tile, tile2lat, tile2lon} from './tileMathUtils.ts';

export interface TileStyle {
    color: string;
    weight: number;
    opacity: number;
    fillColor?: string;
    fillOpacity: number;
    className?: string;
}

interface TileRectangle extends L.Rectangle {
    _tileKey: string;
}

/**
 * A highly-performant, generic function to draw a set of tiles onto a layer group.
 * It incrementally adds and removes tiles based on the current map viewport.
 */
export const drawTiles = (
    leafletMap: L.Map | null,
    layer: L.LayerGroup,
    // The source of tiles can be a simple Set or a Map containing data for each tile.
    tiles: Set<string> | Map<string, any>,
    rendered: Set<string>,
    // The style can be a static object or a function that returns a style for a given tile.
    style: TileStyle | ((key: string, data: any) => TileStyle),
    renderer: L.Canvas | null,
    pad = 1,
    tileRenderZoom: number // The zoom level of the tiles in tileSet and rendered set
) => {
    if (!renderer || !leafletMap) return;

    const viewBoundsPadded = leafletMap.getBounds()?.pad(pad);
    if (!viewBoundsPadded) return;

    const isStyleFn = typeof style === 'function';
    const isTilesMap = tiles instanceof Map;

    const renderedToRemove: string[] = [];
    const northWestView = viewBoundsPadded.getNorthWest();
    const southEastView = viewBoundsPadded.getSouthEast();

    // Calculate view tile range using the passed tileRenderZoom
    const xMinView = lon2tile(northWestView.lng, tileRenderZoom);
    const xMaxView = lon2tile(southEastView.lng, tileRenderZoom);
    const yMinView = lat2tile(northWestView.lat, tileRenderZoom);
    const yMaxView = lat2tile(southEastView.lat, tileRenderZoom);

    rendered.forEach((k) => {
        // Remove if the tile is no longer in the source set or if it's outside the view.
        if (!tiles.has(k)) {
            renderedToRemove.push(k);
            return;
        }
        const [x, y] = k.split(',').map(Number);
        if (x < xMinView || x > xMaxView || y < yMinView || y > yMaxView) {
            renderedToRemove.push(k);
        }
    });

    renderedToRemove.forEach(k => {
        rendered.delete(k);
        layer.eachLayer((l) => {
            const rect = l as TileRectangle;
            if (rect._tileKey === k) layer.removeLayer(rect);
        });
    });

    for (let x = xMinView; x <= xMaxView; x++) {
        for (let y = yMinView; y <= yMaxView; y++) {
            const k = `${x},${y}`;
            if (tiles.has(k) && !rendered.has(k)) {
                // Get the style for this specific tile.
                const tileStyle = isStyleFn
                    ? style(k, isTilesMap ? tiles.get(k) : undefined)
                    : style;

                const lat1 = tile2lat(y, tileRenderZoom);
                const lon1 = tile2lon(x, tileRenderZoom);
                const lat2 = tile2lat(y + 1, tileRenderZoom);
                const lon2 = tile2lon(x + 1, tileRenderZoom);
                const rectBounds: L.LatLngBoundsExpression = [[lat1, lon1], [lat2, lon2]];

                const rect = L.rectangle(rectBounds, {
                    ...tileStyle,
                    renderer,
                    interactive: false,
                }) as TileRectangle;
                rect._tileKey = k;
                rect.addTo(layer);
                rendered.add(k);
            }
        }
    }
};

export const createAggregatedTileMap = (
    sourceTiles: Set<string>,
    sourceZoom: number,
    targetZoom: number
): Map<string, number> => {
    const aggregated = new Map<string, number>();
    if (targetZoom >= sourceZoom) {
        sourceTiles.forEach(tileKey => aggregated.set(tileKey, 1));
        return aggregated;
    }
    const zoomDiff = sourceZoom - targetZoom;
    const factor = Math.pow(2, zoomDiff);
    sourceTiles.forEach(tileKey => {
        const [x, y] = tileKey.split(',').map(Number);
        const aggKey = `${Math.floor(x / factor)},${Math.floor(y / factor)}`;
        aggregated.set(aggKey, (aggregated.get(aggKey) || 0) + 1);
    });
    return aggregated;
};