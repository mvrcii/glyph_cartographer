function tile2lat(y, zoom) {
    const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, zoom);
    return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

function tile2lon(x, zoom) {
    return (x / Math.pow(2, zoom)) * 360 - 180;
}

const Z = 17;

function pointsAreEqual(p1, p2) {
    return p1.x === p2.x && p1.y === p2.y;
}

function getEdgeKey(edge) {
    if (edge.p1.x < edge.p2.x || (edge.p1.x === edge.p2.x && edge.p1.y < edge.p2.y)) {
        return `${edge.p1.x},${edge.p1.y}:${edge.p2.x},${edge.p2.y}`;
    }
    return `${edge.p2.x},${edge.p2.y}:${edge.p1.x},${edge.p1.y}`;
}

function toggleEdge(map, edge) {
    const key = getEdgeKey(edge);
    if (map.has(key)) {
        map.delete(key);
    } else {
        map.set(key, edge);
    }
}

function calculateTileOutlines(tiles) {
    const startTime = performance.now();
    const numTiles = tiles.size;
    if (numTiles === 0) return [];

    const edgeMap = new Map();

    // Find all boundary edges by removing shared, internal edges.
    for (const key of tiles) {
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
    const boundaryEdges = edgeMap.values();
    const polygons = [];
    const visitedEdges = new Set();

    // Optimized polygon stitching:
    // Create a lookup map for finding edges by their endpoints quickly.
    const pointToEdgeMap = new Map();
    for (const edge of boundaryEdges) {
        const p1Key = `${edge.p1.x},${edge.p1.y}`;
        const p2Key = `${edge.p2.x},${edge.p2.y}`;
        if (!pointToEdgeMap.has(p1Key)) pointToEdgeMap.set(p1Key, []);
        if (!pointToEdgeMap.has(p2Key)) pointToEdgeMap.set(p2Key, []);
        pointToEdgeMap.get(p1Key).push(edge);
        pointToEdgeMap.get(p2Key).push(edge);
    }

    // Iterate through all edges to build polygons.
    for (const startEdge of edgeMap.values()) {
        if (visitedEdges.has(getEdgeKey(startEdge))) continue;

        const polygonPoints = [];
        let currentEdge = startEdge;
        let currentPoint = startEdge.p1;

        while (currentEdge && !visitedEdges.has(getEdgeKey(currentEdge))) {
            visitedEdges.add(getEdgeKey(currentEdge));
            polygonPoints.push(currentPoint);

            // Determine the next point in the path.
            const nextPoint = pointsAreEqual(currentEdge.p1, currentPoint) ? currentEdge.p2 : currentEdge.p1;
            currentPoint = nextPoint;

            // Find the next connecting edge that hasn't been visited.
            const connectedEdges = pointToEdgeMap.get(`${nextPoint.x},${nextPoint.y}`) || [];
            currentEdge = connectedEdges.find(edge => !visitedEdges.has(getEdgeKey(edge))) || null;
        }

        // If a complete loop was formed, add it as a polygon.
        if (polygonPoints.length > 0) {
            const latLngs = polygonPoints.map(p => ({lat: tile2lat(p.y, Z), lng: tile2lon(p.x, Z)}));
            polygons.push(latLngs);
        }
    }

    const endTime = performance.now();
    const duration = (endTime - startTime).toFixed(2);
    console.log(
        `[Outline Worker] Processed ${numTiles} tiles in ${duration} ms. ` +
        `Found ${numBoundaryEdges} boundary edges, creating ${polygons.length} polygons.`
    );

    return polygons;
}


// Listen for messages from the main thread.
self.onmessage = (event) => {
    const tileKeys = event.data;
    const tileSet = new Set(tileKeys);
    const outlines = calculateTileOutlines(tileSet);
    self.postMessage(outlines);
};