import { describe, expect, it } from 'vitest'
import { defaultMeetingPoint, pointInPlace } from './place-geometry'

// A "C" shape: its bounding-box centre (101.5, 3.5) is in the empty notch.
const cShape: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [[
    [101, 3], [102, 3], [102, 3.2], [101.2, 3.2], [101.2, 3.8], [102, 3.8], [102, 4], [101, 4], [101, 3],
  ]],
}

describe('event place geometry', () => {
  it('never suggests a meeting point outside a concave place', () => {
    expect(pointInPlace(cShape, { latitude: 3.5, longitude: 101.5 })).toBe(false)
    const point = defaultMeetingPoint(cShape)!
    expect(pointInPlace(cShape, point)).toBe(true)
  })

  it('keeps holes out of the place', () => {
    const withHole: GeoJSON.Polygon = {
      type: 'Polygon',
      coordinates: [
        [[101, 3], [102, 3], [102, 4], [101, 4], [101, 3]],
        [[101.3, 3.3], [101.7, 3.3], [101.7, 3.7], [101.3, 3.7], [101.3, 3.3]],
      ],
    }
    expect(pointInPlace(withHole, { latitude: 3.5, longitude: 101.5 })).toBe(false)
    expect(pointInPlace(withHole, defaultMeetingPoint(withHole)!)).toBe(true)
  })

  it('uses the middle vertex of a trail and leaves trail membership to the API', () => {
    const trail: GeoJSON.LineString = { type: 'LineString', coordinates: [[101, 3], [101.1, 3.1], [101.2, 3.2]] }
    expect(defaultMeetingPoint(trail)).toEqual({ latitude: 3.1, longitude: 101.1 })
    expect(pointInPlace(trail, { latitude: 5, longitude: 110 })).toBe(true)
  })
})
