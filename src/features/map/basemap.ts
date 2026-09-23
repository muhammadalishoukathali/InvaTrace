// One basemap definition for every map screen (threat map, place boundary,
// adopted-area activity), so they can't drift apart again.
//
// Default is OpenFreeMap's "liberty" vector style: OpenStreetMap data, no API
// key, no request caps, and explicitly offered for apps like ours. We used to
// default to tile.openstreetmap.org, but that server is volunteer-run and
// blocks apps it thinks break its tile usage policy - users then get a grid
// of "403 Access blocked" images instead of a map. (CARTO's keyless tiles are
// no better: they now come back stamped "API KEY REQUIRED".)
//
// Overrides, in priority order:
//   VITE_MAP_STYLE_URL  - any MapLibre style JSON URL (e.g. a MapTiler style)
//   VITE_MAP_TILE_URL   - a raster {z}/{x}/{y} template from a keyed provider
// VITE_MAP_TILE_ATTRIBUTION sets the credit shown on the map for either.
import type { StyleSpecification } from 'maplibre-gl'

const env = (value: string | undefined) => value?.trim() || undefined

const styleUrl = env(import.meta.env.VITE_MAP_STYLE_URL as string | undefined)
const tileUrl = env(import.meta.env.VITE_MAP_TILE_URL as string | undefined)
const attribution = env(import.meta.env.VITE_MAP_TILE_ATTRIBUTION as string | undefined)

const DEFAULT_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'

/** Font every app-added symbol layer must use; the default style's glyph
 *  server only carries Noto Sans, and MapLibre's built-in default font
 *  (Open Sans) would 404 there. */
export const BASEMAP_FONT = ['Noto Sans Regular']

/** Plain-text credit for the attribution chip and MapLibre's source metadata. */
export const BASEMAP_ATTRIBUTION: string = attribution
  ?? (styleUrl || tileUrl
    ? '© OpenStreetMap contributors'
    : '© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors')

export const BASEMAP_STYLE: string | StyleSpecification = styleUrl
  ?? (tileUrl
    ? {
        version: 8,
        glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
        sources: {
          'basemap-src': {
            type: 'raster',
            tiles: [tileUrl],
            tileSize: 256,
            maxzoom: 19,
            attribution: BASEMAP_ATTRIBUTION,
          },
        },
        layers: [{ id: 'basemap', type: 'raster', source: 'basemap-src' }],
      }
    : DEFAULT_STYLE_URL)
