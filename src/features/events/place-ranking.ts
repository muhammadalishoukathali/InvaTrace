// Ranks mapped places for the host-event place picker. The full catalogue is
// thousands of OSM parks and trails, so a plain alphabetical slice surfaces
// quoted names, numbered trails and per-segment duplicates first.
import type { PlaceSummary } from '@/types'

/** OSM imports name every extra segment of a split trail "Name · OSM way/123". */
const OSM_SEGMENT = / · OSM (way|relation|node)\/\d+$/

const isFeatured = (place: PlaceSummary) => !place.source.startsWith('OpenStreetMap')
const isSegment = (place: PlaceSummary) => OSM_SEGMENT.test(place.displayName)
const startsWithLetter = (name: string) => /^\p{L}/u.test(name)

function rank(place: PlaceSummary, term: string) {
  const name = place.displayName.toLowerCase()
  return [
    isFeatured(place) ? 0 : 1,
    term && !name.startsWith(term) ? 1 : 0,
    place.placeType === 'trail' ? 1 : 0,
    startsWithLetter(place.displayName) ? 0 : 1,
  ]
}

export function rankPlaces(places: PlaceSummary[], search: string, limit = 40): PlaceSummary[] {
  const term = search.trim().toLowerCase()
  return places
    .filter((place) => term
      ? place.displayName.toLowerCase().includes(term)
      : !isSegment(place))
    // Segments only appear when searched for, and then after their parent trail.
    .map((place) => ({ place, key: [...rank(place, term), isSegment(place) ? 1 : 0] }))
    .sort((a, b) => {
      for (let index = 0; index < a.key.length; index += 1) {
        if (a.key[index] !== b.key[index]) return a.key[index] - b.key[index]
      }
      return a.place.displayName.localeCompare(b.place.displayName, 'en')
    })
    .slice(0, limit)
    .map(({ place }) => place)
}
