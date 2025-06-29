export const TILE_GRID_ZOOM = 17;

/**
 * The minimum map zoom level at which to start showing the
 * high-resolution custom satellite imagery instead of the vector tiles.
 * The satellite images will be shown from this level up to zoom 17.
 *
 * Example values:
 * 17 = Show imagery ONLY at zoom 17.
 * 16 = Show imagery at zooms 16 and 17.
 * 15 = Show imagery at zooms 15, 16, and 17.
 */
export const ZOOM_THRESHOLD = 16;