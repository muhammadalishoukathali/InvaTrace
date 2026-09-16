/**
 * Locally bundled SVG icons for the four mapped place types shown on the
 * threat map. Icons are inlined as data URLs so they ship with the JS
 * bundle - no external icon service, no unrecorded licence dependency, no
 * extra network request. Each icon combines a distinct shape *and* a
 * distinct colour so the four types are still separable for users with
 * colour-vision differences.
 *
 * The `formatPlaceType` helper maps raw OSM tag values (e.g. `wood`) to
 * their user-facing label (`Woodland`).
 */

export type PlaceType = 'park' | 'forest' | 'wood' | 'trail'

export interface PlaceIconSpec {
  id: string
  label: string
  fill: string
  stroke: string
  /** Raw SVG markup at 40x40, viewBox 0 0 40 40. */
  svg: string
}

const CIRCLE = (fill: string, stroke: string) =>
  `<circle cx="20" cy="20" r="17" fill="${fill}" stroke="${stroke}" stroke-width="2.5"/>`

export const PLACE_ICONS: Record<PlaceType, PlaceIconSpec> = {
  park: {
    id: 'place-icon-park',
    label: 'Park',
    fill: '#6D3FB5',
    stroke: '#FFFFFF',
    svg: `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40">
        ${CIRCLE('#6D3FB5', '#FFFFFF')}
        <path d="M20 11 C 15 14 12 18 12 22 C 12 25 14 27 17 27 L 17 30 L 23 30 L 23 27 C 26 27 28 25 28 22 C 28 18 25 14 20 11 Z"
              fill="#FFFFFF"/>
        <path d="M20 15 C 22 18 23 20 23 22" stroke="#6D3FB5" stroke-width="1.4" stroke-linecap="round" fill="none"/>
      </svg>`,
  },
  forest: {
    id: 'place-icon-forest',
    label: 'Forest',
    fill: '#176B45',
    stroke: '#FFFFFF',
    svg: `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40">
        ${CIRCLE('#176B45', '#FFFFFF')}
        <path d="M13 25 L 17 15 L 21 25 Z" fill="#FFFFFF"/>
        <path d="M19 28 L 23 17 L 27 28 Z" fill="#FFFFFF"/>
        <rect x="16.2" y="25" width="1.6" height="4" fill="#FFFFFF"/>
        <rect x="22.2" y="28" width="1.6" height="3" fill="#FFFFFF"/>
      </svg>`,
  },
  wood: {
    id: 'place-icon-woodland',
    label: 'Woodland',
    fill: '#9A6518',
    stroke: '#FFFFFF',
    svg: `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40">
        ${CIRCLE('#9A6518', '#FFFFFF')}
        <path d="M20 12 L 15 22 L 18 22 L 15 28 L 25 28 L 22 22 L 25 22 Z" fill="#FFFFFF"/>
        <rect x="19.2" y="28" width="1.6" height="3.5" fill="#FFFFFF"/>
      </svg>`,
  },
  trail: {
    id: 'place-icon-trail',
    label: 'Trail',
    fill: '#176FA8',
    stroke: '#FFFFFF',
    svg: `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40">
        ${CIRCLE('#176FA8', '#FFFFFF')}
        <rect x="19.2" y="12" width="1.6" height="18" fill="#FFFFFF"/>
        <rect x="12" y="15" width="10" height="4" rx="0.6" fill="#FFFFFF"/>
        <rect x="18" y="21" width="10" height="4" rx="0.6" fill="#FFFFFF"/>
      </svg>`,
  },
}

export const PLACE_TYPES: PlaceType[] = ['park', 'forest', 'wood', 'trail']

/**
 * Convert a raw place-type value into its user-facing label. In OSM the
 * `landuse=forest` value covers dense forest while `natural=wood` is the
 * lower-canopy woodland tag; the raw string "wood" is confusing so we
 * always surface it as "Woodland" in UI. Unknown values pass through
 * with initial-cap so we degrade sensibly for future data.
 */
export function formatPlaceType(placeType: string | null | undefined): string {
  if (!placeType) return 'Place'
  if (placeType === 'wood') return 'Woodland'
  const spec = (PLACE_ICONS as Record<string, PlaceIconSpec | undefined>)[placeType]
  if (spec) return spec.label
  return placeType.charAt(0).toUpperCase() + placeType.slice(1)
}

/** Convert one bundled SVG string into a browser-safe data URL. */
export function svgDataUrl(svg: string): string {
  const trimmed = svg.trim().replace(/\s+/g, ' ')
  const encoded = encodeURIComponent(trimmed)
    .replace(/'/g, '%27')
    .replace(/"/g, '%22')
  return `data:image/svg+xml;charset=utf-8,${encoded}`
}

/**
 * Decode a bundled SVG with the browser before handing it to MapLibre.
 * MapLibre's URL loader only guarantees raster formats, while addImage
 * accepts an already-decoded HTMLImageElement. This keeps the vector icons
 * local without relying on unsupported SVG URL loading.
 */
export function loadSvgImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image(40, 40)
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('The bundled place icon could not be decoded.'))
    image.src = svgDataUrl(svg)
  })
}
