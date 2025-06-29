export function lat2tile(lat: number, zoom: number): number {
    return Math.floor(
        (1 -
            Math.log(Math.tan((lat * Math.PI) / 180) +
                1 / Math.cos((lat * Math.PI) / 180)) /
            Math.PI) /
        2 *
        Math.pow(2, zoom)
    );
}

export function lon2tile(lon: number, zoom: number): number {
    return Math.floor(((lon + 180) / 360) * Math.pow(2, zoom));
}

export function tile2lat(y: number, zoom: number): number {
    const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, zoom);
    return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

export function tile2lon(x: number, zoom: number): number {
    return (x / Math.pow(2, zoom)) * 360 - 180;
}


/* convert lat/lng bounds → inclusive tile ranges at zoom 17 */
export function tilesInBounds(bounds: L.LatLngBounds, z = 17) {
    const north = bounds.getNorth();
    const south = bounds.getSouth();
    const west = bounds.getWest();
    const east = bounds.getEast();

    const xMin = Math.floor((west + 180) / 360 * 2 ** z);
    const xMax = Math.floor((east + 180) / 360 * 2 ** z);
    const yMin = Math.floor(
        (1 - Math.log(Math.tan(north * Math.PI / 180) +
            1 / Math.cos(north * Math.PI / 180)) / Math.PI) / 2 * 2 ** z
    );
    const yMax = Math.floor(
        (1 - Math.log(Math.tan(south * Math.PI / 180) +
            1 / Math.cos(south * Math.PI / 180)) / Math.PI) / 2 * 2 ** z
    );

    return {xMin, xMax, yMin, yMax};
}


export function calculateTileAreaKm2(xMin: number, xMax: number, yMin: number, yMax: number, zoom: number): number {
    const north = tile2lat(yMin, zoom);
    const south = tile2lat(yMax + 1, zoom);
    const west = tile2lon(xMin, zoom);
    const east = tile2lon(xMax + 1, zoom);

    // Approximate area calculation
    const R = 6371; // Earth's radius in km
    const dLat = (south - north) * Math.PI / 180;
    const dLon = (east - west) * Math.PI / 180;
    const meanLat = (north + south) / 2 * Math.PI / 180;

    return R * R * Math.abs(dLat) * Math.abs(dLon) * Math.cos(meanLat);
}

export const parseCoordinates = (input: string): { lat: number, lon: number, zoom: number } | null => {
    input = input.trim();
    let match;

    // Try Z/X/Y or Z-X-Y format
    match = input.match(/^(\d+)[/-](\d+)[/-](\d+)$/);
    if (match) {
        const [z, x, y] = match.slice(1).map(Number);
        if (z >= 0 && z <= 22) {
            return {lat: tile2lat(y + 0.5, z), lon: tile2lon(x + 0.5, z), zoom: z};
        }
    }

    // Try X/Y or X-Y format (assume Z=17)
    match = input.match(/^(\d+)[/-](\d+)$/);
    if (match) {
        const [x, y] = match.slice(1).map(Number);
        const z = 17;
        return {lat: tile2lat(y + 0.5, z), lon: tile2lon(x + 0.5, z), zoom: z};
    }

    // Try decimal degrees with/without comma
    match = input.match(/^(-?\d{1,3}(?:\.\d+)?)[,\s]+(-?\d{1,3}(?:\.\d+)?)$/);
    if (match) {
        const [lat, lon] = match.slice(1).map(parseFloat);
        if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
            return {lat, lon, zoom: 17};
        }
    }

    // Try specific DMS format: DD°MM'SS"D DDD°MM'SS"D
    match = input.match(/^(\d{1,2})°(\d{1,2})'(\d{1,2}(?:\.\d+)?)"([NS])\s+(\d{1,3})°(\d{1,2})'(\d{1,2}(?:\.\d+)?)"([EW])$/i);
    if (match) {
        const [, latDeg, latMin, latSec, latDir, lonDeg, lonMin, lonSec, lonDir] = match;

        const lat = parseInt(latDeg) + parseInt(latMin) / 60 + parseFloat(latSec) / 3600;
        const lon = parseInt(lonDeg) + parseInt(lonMin) / 60 + parseFloat(lonSec) / 3600;

        const finalLat = latDir.toUpperCase() === 'S' ? -lat : lat;
        const finalLon = lonDir.toUpperCase() === 'W' ? -lon : lon;

        if (finalLat >= -90 && finalLat <= 90 && finalLon >= -180 && finalLon <= 180) {
            return {lat: finalLat, lon: finalLon, zoom: 17};
        }
    }

    // Try original DMS with N/S/E/W indicators
    match = input.match(/(\d{1,3}(?:°|º|d| ))\s*(\d{1,2}(?:'|m| ))?\s*(\d{1,2}(?:\.\d+)?(?:"|s))?\s*([NS])\s*[,\s]+\s*(\d{1,3}(?:°|º|d| ))\s*(\d{1,2}(?:'|m| ))?\s*(\d{1,2}(?:\.\d+)?(?:"|s))?\s*([WE])/i);
    if (match) {
        const [, d1, m1, s1, ns, d2, m2, s2, we] = match;
        const parseDms = (dStr: string, mStr: string | undefined, sStr: string | undefined, sign: string) => {
            const deg = parseFloat(dStr.replace(/[^0-9.]/g, ''));
            const min = mStr ? parseFloat(mStr.replace(/[^0-9.]/g, '')) : 0;
            const sec = sStr ? parseFloat(sStr.replace(/[^0-9.]/g, '')) : 0;
            let decimal = deg + min / 60 + sec / 3600;
            if (sign === 'S' || sign === 'W') {
                decimal *= -1;
            }
            return decimal;
        };
        const lat = parseDms(d1, m1, s1, ns.toUpperCase());
        const lon = parseDms(d2, m2, s2, we.toUpperCase());

        if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
            return {lat, lon, zoom: 17};
        }
    }

    return null;
};