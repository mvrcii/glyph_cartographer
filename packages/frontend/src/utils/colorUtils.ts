interface RGB {
    r: number;
    g: number;
    b: number;
}

/**
 * Converts a CSS HEX color string to an RGB object.
 * Handles both 3-digit (#RGB) and 6-digit (#RRGGBB) formats.
 * @param hex The hex color string (e.g., "#FFF", "#ff0000").
 * @returns An object with r, g, b properties, or null if the input is invalid.
 */
export function hexToRgb(hex: string): RGB | null {
    if (!hex || typeof hex !== 'string') {
        return null;
    }

    // Expand shorthand form (e.g. "03F") to full form (e.g. "0033FF")
    const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
    const processedHex = hex.replace(shorthandRegex, (_, r, g, b) => {
        return r + r + g + g + b + b;
    });

    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(processedHex);

    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
}