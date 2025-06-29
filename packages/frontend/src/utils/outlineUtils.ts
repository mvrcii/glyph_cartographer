import L from 'leaflet';
import {tile2lat, tile2lon} from './tileMathUtils.ts';

const Z = 17;

const latCache = new Map<number, number>();
const lonCache = new Map<number, number>();

function cachedLat(y: number): number {
    let v = latCache.get(y);
    if (v === undefined) {
        v = tile2lat(y, Z);
        latCache.set(y, v);
    }
    return v;
}

function cachedLon(x: number): number {
    let v = lonCache.get(x);
    if (v === undefined) {
        v = tile2lon(x, Z);
        lonCache.set(x, v);
    }
    return v;
}

type Point = { x: number; y: number };
type Edge = { p1: Point; p2: Point };

/**
 * Calculates the geographic outlines of connected groups of tiles.
 * @param tiles - A Set of tile keys in "x,y" format.
 * @returns An array of polygons, where each polygon is an array of LatLng points.
 */
export function calculateTileOutlines(tiles: Set<string>): L.LatLng[][] {
    const startTime = performance.now();
    const numTiles = tiles.size;
    if (numTiles === 0) return [];

    const tileCoords: Set<string> = tiles;
    const edgeMap = new Map<string, Edge>();

    // Find all boundary edges using a duplicate-removal strategy
    for (const key of tileCoords) {
        const [x, y] = key.split(',').map(Number);

        const topEdge = {p1: {x, y}, p2: {x: x + 1, y}};
        const rightEdge = {p1: {x: x + 1, y}, p2: {x: x + 1, y: y + 1}};
        const bottomEdge = {p1: {x, y: y + 1}, p2: {x: x + 1, y: y + 1}};
        const leftEdge = {p1: {x, y}, p2: {x, y: y + 1}};

        toggleEdge(edgeMap, topEdge);
        toggleEdge(edgeMap, rightEdge);
        toggleEdge(edgeMap, bottomEdge);
        toggleEdge(edgeMap, leftEdge);
    }

    const numBoundaryEdges = edgeMap.size;
    const boundaryEdges = Array.from(edgeMap.values());
    const polygons: L.LatLng[][] = [];

    // Connect the boundary edges into polygons
    while (boundaryEdges.length > 0) {
        const polygonPoints: Point[] = [];
        const currentEdge = boundaryEdges.pop()!;
        polygonPoints.push(currentEdge.p1, currentEdge.p2);

        while (polygonPoints.length > 0) {
            const lastPoint = polygonPoints[polygonPoints.length - 1];
            const nextEdgeIndex = boundaryEdges.findIndex(
                edge => pointsAreEqual(edge.p1, lastPoint) || pointsAreEqual(edge.p2, lastPoint)
            );

            if (nextEdgeIndex !== -1) {
                const [nextEdge] = boundaryEdges.splice(nextEdgeIndex, 1);
                const nextPoint = pointsAreEqual(nextEdge.p1, lastPoint) ? nextEdge.p2 : nextEdge.p1;
                polygonPoints.push(nextPoint);
            } else {
                break;
            }
        }

        const latLngs = polygonPoints.map(p => L.latLng(cachedLat(p.y), cachedLon(p.x)));
        polygons.push(latLngs);
    }

    const endTime = performance.now();
    const duration = (endTime - startTime).toFixed(2);
    console.log(
        `[Outline Calculation] Processed ${numTiles} tiles in ${duration} ms. ` +
        `Found ${numBoundaryEdges} boundary edges, creating ${polygons.length} polygons.`
    );

    return polygons;
}

function pointsAreEqual(p1: Point, p2: Point): boolean {
    return p1.x === p2.x && p1.y === p2.y;
}

function getEdgeKey(edge: Edge): string {
    if (edge.p1.x < edge.p2.x || (edge.p1.x === edge.p2.x && edge.p1.y < edge.p2.y)) {
        return `${edge.p1.x},${edge.p1.y}:${edge.p2.x},${edge.p2.y}`;
    }
    return `${edge.p2.x},${edge.p2.y}:${edge.p1.x},${edge.p1.y}`;
}

function toggleEdge(map: Map<string, Edge>, edge: Edge): void {
    const key = getEdgeKey(edge);
    if (map.has(key)) {
        map.delete(key);
    } else {
        map.set(key, edge);
    }
}