import { describe, expect, it } from 'vitest'
import type { PlaceSummary } from '@/types'
import { rankPlaces } from './place-ranking'

const place = (displayName: string, placeType: PlaceSummary['placeType'], source = 'OpenStreetMap'): PlaceSummary => ({
  placeId: displayName, displayName, placeType, source,
  geometryStatus: 'available', geometryVersion: 'v1', viewPlantsUrl: `/places/${displayName}`,
} as PlaceSummary)

const catalogue = [
  place('"Dry" Trail', 'trail'),
  place('"Wet" Trail · OSM way/1209670085', 'trail'),
  place('12 Corners', 'trail'),
  place('Alam Damai Recreational Park', 'park'),
  place('Ampang Forest Reserve', 'forest', 'invatrace-featured-seed-v1'),
  place('Bukit Gasing Trail', 'trail', 'invatrace-featured-seed-v1'),
  place('Gasing Ridge Trail', 'trail'),
  place('Taman Tasik Titiwangsa', 'park', 'invatrace-featured-seed-v1'),
  place('Wet Trail', 'trail'),
]
const names = (items: PlaceSummary[]) => items.map((item) => item.displayName)

describe('rankPlaces', () => {
  it('leads with featured places, then areas, then trails, punctuated names last', () => {
    expect(names(rankPlaces(catalogue, ''))).toEqual([
      'Ampang Forest Reserve', 'Taman Tasik Titiwangsa', 'Bukit Gasing Trail',
      'Alam Damai Recreational Park', 'Gasing Ridge Trail', 'Wet Trail', '"Dry" Trail', '12 Corners',
    ])
  })

  it('hides OSM segment duplicates unless searched for', () => {
    expect(names(rankPlaces(catalogue, 'wet'))).toEqual(['Wet Trail', '"Wet" Trail · OSM way/1209670085'])
  })

  it('puts prefix matches before other matches', () => {
    expect(names(rankPlaces(catalogue, 'gasing'))).toEqual(['Bukit Gasing Trail', 'Gasing Ridge Trail'])
  })
})
