export interface Geoglyph {
    name: string;
    points: L.LatLngExpression[];
    center: L.LatLngExpression;
}

/**
 * Parses a KML string to extract geoglyph LineString data.
 * @param kmlText The raw KML content as a string.
 * @returns An array of Geoglyph objects.
 */
export const parseKML = (kmlText: string): Geoglyph[] => {
    const parser = new DOMParser();
    const kml = parser.parseFromString(kmlText, "application/xml");

    const errorNode = kml.querySelector("parsererror");
    if (errorNode) {
        console.error("Failed to parse KML:", errorNode.textContent);
        return [];
    }

    const placemarks = kml.querySelectorAll("Placemark");
    const geoglyphs: Geoglyph[] = [];

    placemarks.forEach(pm => {
        const name = pm.querySelector("name")?.textContent || "Unnamed";
        const coordsString = pm.querySelector("LineString > coordinates")?.textContent?.trim();

        if (coordsString) {
            const points = coordsString.split(/\s+/)
                .map(coordPair => {
                    const [lon, lat] = coordPair.split(',').map(Number);
                    // Leaflet expects [lat, lon], so we swap them.
                    return [lat, lon] as L.LatLngExpression;
                })
                .filter(p => Array.isArray(p) && !isNaN(p[0]) && !isNaN(p[1]));

            if (points.length > 0) {
                // Calculate a rough center for the abstracted point view
                const centerLat = points.reduce((sum, p) => sum + (p as number[])[0], 0) / points.length;
                const centerLng = points.reduce((sum, p) => sum + (p as number[])[1], 0) / points.length;
                geoglyphs.push({name, points, center: [centerLat, centerLng]});
            }
        }
    });

    return geoglyphs;
};