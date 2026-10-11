// Server-side rules behind place discovery (US 5.1) and adopted areas (Epic 6),
// proved against the real FastAPI + PostGIS stack with its featured-place seed.
// Needs the Compose stack with `app.cli seed-featured-places` applied.
import { expect, test, type APIRequestContext, type Browser } from '@playwright/test'
import { API_URL, fix, northOf, publishSighting, startProfile, type Session } from '../fixtures/real-api'

// Starting an identity can wait out a one-minute limiter window.
test.describe.configure({ timeout: 240_000 })

type Place = {
  placeId: string
  displayName: string
  placeType: string
  geometryStatus: string
  geometry?: { type: string; coordinates: number[][][][] }
}
type Community = {
  speciesId: string; scientificName: string; commonNames: string[]; activeReports: number
  removalReports: number; relations: string[]; nearestDistanceM: number | null; sourceLabel: string
}
type Associations = { items: Array<{ evidence: { relations?: string[] } }>; communityReports: Community[]; disclaimer: string }
type Area = {
  adoptionId: string; placeId: string; name: string
  metrics: { activeReports: number; distinctApprovedSpecies: number; newReportsLast30Days: number; removalReportsLast30Days: number }
}
type Activity = {
  markers: Array<{ sightingId: string; speciesId: string; status: string; statusDate: string; observationDate: string; communityLabel: string }>
  filteredCount: number
  concentrations: Array<{ reportCount: number }>
  comparison: { recent0To29Days: number; prior30To59Days: number; direction: string }
  emptyMessage: string | null
  disclaimer: string
}

const MIKANIA = 'mikania-micrantha'

async function polygonPlace(request: APIRequestContext, session: Session, name: string) {
  const list = await request.get(`${API_URL}/api/v1/places`, { headers: session.headers, params: { limit: 50 } })
  const match = (await list.json() as { items: Place[] }).items.find((place) => place.displayName === name)
  test.skip(!match, `The featured place "${name}" is not seeded in this environment.`)
  const detail = await (await request.get(`${API_URL}/api/v1/places/${match!.placeId}`, { headers: session.headers })).json() as Place
  const ring = detail.geometry!.coordinates[0][0]
  const lngs = ring.map((corner) => corner[0])
  const lats = ring.map((corner) => corner[1])
  // A random point well inside the square, so separate runs do not stack on one spot.
  const within = (low: number, high: number) => low + (high - low) * (0.3 + Math.random() * 0.4)
  return {
    place: detail,
    inside: { lat: within(Math.min(...lats), Math.max(...lats)), lng: within(Math.min(...lngs), Math.max(...lngs)) },
    northEdge: { lat: Math.max(...lats), lng: (Math.min(...lngs) + Math.max(...lngs)) / 2 },
  }
}

const associations = async (request: APIRequestContext, session: Session, placeId: string) =>
  await (await request.get(`${API_URL}/api/v1/places/${placeId}/plant-associations`, { headers: session.headers })).json() as Associations

const mikaniaIn = (body: Associations) => body.communityReports.find((entry) => entry.speciesId === MIKANIA)

async function adopt(request: APIRequestContext, session: Session, placeId: string) {
  const response = await request.post(`${API_URL}/api/v1/adopted-areas`, { headers: session.headers, data: { placeId } })
  expect(response.status()).toBe(201)
  return await response.json() as { adoptionId: string; placeId: string; disclaimer: string }
}

const areas = async (request: APIRequestContext, session: Session) =>
  (await (await request.get(`${API_URL}/api/v1/adopted-areas`, { headers: session.headers })).json() as { items: Area[] }).items

const activity = async (request: APIRequestContext, session: Session, adoptionId: string, params: Record<string, string> = {}) =>
  await (await request.get(`${API_URL}/api/v1/adopted-areas/${adoptionId}/activity`, { headers: session.headers, params })).json() as Activity

/** A second identity reports, so the near-duplicate merge (same identity only) never hides a sighting. */
async function sightingBy(request: APIRequestContext, browser: Browser, point: { lat: number; lng: number }) {
  const reporter = await startProfile(request)
  return { reporter, report: await publishSighting(request, browser, reporter, point) }
}

test('AC 5.1.1 Supported place selection: only mapped trails, parks, forests and woods with usable geometry are offered', async ({ request }) => {
  const session = await startProfile(request)
  const list = await (await request.get(`${API_URL}/api/v1/places`, { headers: session.headers, params: { limit: 50 } })).json() as { items: Place[] }
  test.skip(list.items.length === 0, 'No places are seeded in this environment.')
  for (const place of list.items) {
    expect(['trail', 'park', 'forest', 'wood']).toContain(place.placeType)
    expect(place.geometryStatus).toBe('available')
  }
  const unknown = await request.get(`${API_URL}/api/v1/places/00000000-0000-4000-8000-000000000000/plant-associations`, { headers: session.headers })
  expect(unknown.status()).toBe(404)
})

test('AC 5.1.2, AC 5.1.3, AC 5.1.4 Direct and nearby association is computed from stored geometry and shown in its own labelled tier', async ({ request, browser }) => {
  const viewer = await startProfile(request)
  const { place, inside, northEdge } = await polygonPlace(request, viewer, 'Bukit Gasing Forest Park')
  const before = mikaniaIn(await associations(request, viewer, place.placeId))

  await sightingBy(request, browser, inside)
  const withInside = await associations(request, viewer, place.placeId)
  const direct = mikaniaIn(withInside)!
  expect(direct.activeReports).toBe((before?.activeReports ?? 0) + 1)
  expect(direct.relations).toContain('inside_boundary')
  // AC 5.1.4: what the result card needs, with the community tier labelled as such.
  expect(direct).toMatchObject({ scientificName: 'Mikania micrantha', sourceLabel: 'Community report - not expert validated' })
  expect(direct.commonNames.length).toBeGreaterThan(0)
  expect(withInside.disclaimer).toMatch(/not probabilities/i)

  // 150 m outside the boundary counts as nearby, not inside.
  await sightingBy(request, browser, northOf(northEdge, 150))
  const withNearby = mikaniaIn(await associations(request, viewer, place.placeId))!
  expect(withNearby.activeReports).toBe(direct.activeReports + 1)
  expect(withNearby.relations).toEqual(expect.arrayContaining(['inside_boundary', 'nearby_buffer']))
  // AC 5.1.3: direct evidence is listed ahead of buffer evidence.
  expect(withNearby.relations.indexOf('inside_boundary')).toBeLessThan(withNearby.relations.indexOf('nearby_buffer'))

  // Several kilometres away is no association at all.
  const far = await sightingBy(request, browser, northOf(northEdge, 9000))
  expect(mikaniaIn(await associations(request, viewer, place.placeId))!.activeReports).toBe(withNearby.activeReports)
  expect(far.report.sightingId).toBeTruthy()
})

test('AC 5.1.5 No evidence response: a place with no records returns empty tiers and the limitation, not invented plants', async ({ request }) => {
  const session = await startProfile(request)
  // Outside the area the other real-stack tests report in.
  const { place } = await polygonPlace(request, session, 'Putrajaya Botanical Garden')
  const body = await associations(request, session, place.placeId)
  expect(body.items).toEqual([])
  expect(body.communityReports).toEqual([])
  expect(body.disclaimer).toMatch(/do not show current presence or absence/i)
})

test('AC 6.1.1, AC 6.1.3, AC 6.1.4, AC 6.1.6 Adoption is a private, non-exclusive bookmark and adopting twice keeps one record', async ({ request }) => {
  const first = await startProfile(request)
  const second = await startProfile(request)
  const { place } = await polygonPlace(request, first, 'Taman Tugu')

  const adopted = await adopt(request, first, place.placeId)
  expect(adopted.placeId).toBe(place.placeId)
  expect(adopted.disclaimer).toMatch(/non-exclusive/i)
  expect(adopted.disclaimer).toMatch(/does not create ownership/i)
  expect(adopted.disclaimer).toMatch(/permission to remove plants/i)

  // The same identity adopting again gets the same record back.
  const again = await adopt(request, first, place.placeId)
  expect(again.adoptionId).toBe(adopted.adoptionId)
  expect((await areas(request, first)).filter((area) => area.placeId === place.placeId)).toHaveLength(1)

  // Another identity can adopt the same place, with its own record.
  const theirs = await adopt(request, second, place.placeId)
  expect(theirs.adoptionId).not.toBe(adopted.adoptionId)
  expect((await areas(request, second)).map((area) => area.adoptionId)).toEqual([theirs.adoptionId])
  // One identity cannot read the other's adoption.
  const peek = await request.get(`${API_URL}/api/v1/adopted-areas/${adopted.adoptionId}/activity`, { headers: second.headers })
  expect(peek.status()).toBe(404)
})

test('AC 6.1.5 Remove an adoption: only the bookmark goes; reports and other identities\' adoptions stay', async ({ request, browser }) => {
  const owner = await startProfile(request)
  const other = await startProfile(request)
  const { place, inside } = await polygonPlace(request, owner, 'Taman Tasik Permaisuri')
  const { report } = await sightingBy(request, browser, inside)
  const mine = await adopt(request, owner, place.placeId)
  const theirs = await adopt(request, other, place.placeId)

  const removed = await request.delete(`${API_URL}/api/v1/adopted-areas/${mine.adoptionId}`, { headers: owner.headers })
  expect(removed.status()).toBe(204)
  expect(await areas(request, owner)).toEqual([])
  expect((await areas(request, other)).map((area) => area.adoptionId)).toEqual([theirs.adoptionId])
  const sighting = await request.get(`${API_URL}/api/v1/sightings/${report.sightingId}`)
  expect(sighting.status()).toBe(200)
  // Removing someone else's adoption is refused.
  const foreign = await request.delete(`${API_URL}/api/v1/adopted-areas/${theirs.adoptionId}`, { headers: owner.headers })
  expect(foreign.status()).toBe(404)
})

test('AC 6.2.1, AC 6.2.2, AC 6.2.3 Adopted-area indicators count exactly the reports inside the stored boundary', async ({ request, browser }) => {
  const owner = await startProfile(request)
  const { place, inside, northEdge } = await polygonPlace(request, owner, 'Kepong Metropolitan Park')
  const adoption = await adopt(request, owner, place.placeId)
  const [before] = await areas(request, owner)
  expect(before).toMatchObject({ adoptionId: adoption.adoptionId, name: 'Kepong Metropolitan Park' })
  for (const metric of ['activeReports', 'distinctApprovedSpecies', 'newReportsLast30Days', 'removalReportsLast30Days'] as const) {
    expect(typeof before.metrics[metric]).toBe('number')
  }

  const insideSighting = await sightingBy(request, browser, inside)
  const outsideSighting = await sightingBy(request, browser, northOf(northEdge, 400))
  const [after] = await areas(request, owner)
  expect(after.metrics.activeReports).toBe(before.metrics.activeReports + 1)
  expect(after.metrics.newReportsLast30Days).toBe(before.metrics.newReportsLast30Days + 1)
  expect(after.metrics.distinctApprovedSpecies).toBeGreaterThanOrEqual(1)

  // The list and the activity view agree on membership.
  const view = await activity(request, owner, adoption.adoptionId)
  const ids = view.markers.map((marker) => marker.sightingId)
  expect(ids).toContain(insideSighting.report.sightingId)
  expect(ids).not.toContain(outsideSighting.report.sightingId)
  expect(view.markers.filter((marker) => marker.status === 'screened')).toHaveLength(after.metrics.activeReports)
})

test('AC 6.3.1, AC 6.3.2, AC 6.3.3, AC 6.3.5 Area activity is restricted to the area, dated by status, filterable, and compared by raw counts', async ({ request, browser }) => {
  const owner = await startProfile(request)
  const { place, inside } = await polygonPlace(request, owner, 'Desa ParkCity Central Park')
  const adoption = await adopt(request, owner, place.placeId)
  const { reporter, report } = await sightingBy(request, browser, inside)

  const all = await activity(request, owner, adoption.adoptionId)
  const marker = all.markers.find((entry) => entry.sightingId === report.sightingId)!
  expect(marker).toMatchObject({ speciesId: MIKANIA, status: 'screened', communityLabel: 'Community report - not expert validated' })
  expect(Date.parse(marker.statusDate)).toBeGreaterThan(Date.now() - 5 * 60_000)
  expect(all.filteredCount).toBe(all.markers.length)
  // Both raw counts are present and the direction follows from them alone.
  const { recent0To29Days, prior30To59Days, direction } = all.comparison
  expect(recent0To29Days).toBeGreaterThanOrEqual(1)
  expect(direction).toBe(recent0To29Days > prior30To59Days ? 'increased' : recent0To29Days < prior30To59Days ? 'decreased' : 'unchanged')
  expect(JSON.stringify(all)).not.toMatch(/improv|deteriorat|healthier|recover/i)

  // Filters: species, status and period each narrow the same member set.
  const otherSpecies = await activity(request, owner, adoption.adoptionId, { species_id: 'chromolaena-odorata' })
  expect(otherSpecies.markers.map((entry) => entry.sightingId)).not.toContain(report.sightingId)
  const removedOnly = await activity(request, owner, adoption.adoptionId, { status: 'removal_reported' })
  expect(removedOnly.markers.map((entry) => entry.sightingId)).not.toContain(report.sightingId)
  const lastThirty = await activity(request, owner, adoption.adoptionId, { period: '30', species_id: MIKANIA, status: 'screened' })
  expect(lastThirty.markers.map((entry) => entry.sightingId)).toContain(report.sightingId)

  // A removal report changes the marker's status and its status date.
  const removal = await request.post(`${API_URL}/api/v1/reports/${report.id}/removal`, { headers: reporter.headers, data: fix(northOf(inside, 5)) })
  expect(removal.status()).toBe(200)
  const afterRemoval = await activity(request, owner, adoption.adoptionId, { status: 'removal_reported' })
  const removedMarker = afterRemoval.markers.find((entry) => entry.sightingId === report.sightingId)!
  expect(removedMarker.status).toBe('removal_reported')
  expect(Date.parse(removedMarker.statusDate)).toBeGreaterThanOrEqual(Date.parse(marker.statusDate))
})

test('AC 6.2.6, AC 6.3.6 Empty states: no adoptions is an empty list, and an area without reports says so', async ({ request }) => {
  const owner = await startProfile(request)
  expect(await areas(request, owner)).toEqual([])
  const { place } = await polygonPlace(request, owner, 'Putrajaya Botanical Garden')
  const adoption = await adopt(request, owner, place.placeId)
  const view = await activity(request, owner, adoption.adoptionId)
  expect(view.markers).toEqual([])
  expect(view.concentrations).toEqual([])
  expect(view.comparison).toEqual({ recent0To29Days: 0, prior30To59Days: 0, direction: 'unchanged' })
  expect(view.emptyMessage).toBe('No community reports recorded for this area.')
})

test('AC 6.2.5 Sorting: the server orders adopted areas by latest report with no-report areas last, or by name', async ({ request, browser }) => {
  const owner = await startProfile(request)
  const quiet = await polygonPlace(request, owner, 'Putrajaya Botanical Garden')
  const busy = await polygonPlace(request, owner, 'Taman Tasik Titiwangsa')
  await adopt(request, owner, quiet.place.placeId)
  await adopt(request, owner, busy.place.placeId)
  await sightingBy(request, browser, busy.inside)

  const sorted = async (sort: string) =>
    (await (await request.get(`${API_URL}/api/v1/adopted-areas`, { headers: owner.headers, params: { sort } })).json() as { items: Area[] })
      .items.map((area) => area.name)
  expect(await sorted('recent_activity')).toEqual(['Taman Tasik Titiwangsa', 'Putrajaya Botanical Garden'])
  expect(await sorted('name')).toEqual(['Putrajaya Botanical Garden', 'Taman Tasik Titiwangsa'])
})

test('AC 6.3.4 Recent reporting concentrations: three active reports within 250 m form one group, and two do not', async ({ request, browser }) => {
  const owner = await startProfile(request)
  const { place, inside } = await polygonPlace(request, owner, 'KLCC Park')
  const adoption = await adopt(request, owner, place.placeId)
  const before = await activity(request, owner, adoption.adoptionId)
  const groupedBefore = before.concentrations.reduce((sum, group) => sum + group.reportCount, 0)

  // Different identities a few metres apart, so nothing merges as a near-duplicate.
  await sightingBy(request, browser, inside)
  await sightingBy(request, browser, northOf(inside, 8))
  const two = await activity(request, owner, adoption.adoptionId)
  if (before.markers.length === 0) expect(two.concentrations).toEqual([])

  const third = await sightingBy(request, browser, northOf(inside, 16))
  const three = await activity(request, owner, adoption.adoptionId)
  expect(three.concentrations.length).toBeGreaterThan(0)
  for (const group of three.concentrations) expect(group.reportCount).toBeGreaterThanOrEqual(3)
  expect(three.concentrations.reduce((sum, group) => sum + group.reportCount, 0)).toBeGreaterThanOrEqual(Math.max(3, groupedBefore))

  // A removal-reported sighting no longer counts towards a concentration.
  const removal = await request.post(`${API_URL}/api/v1/reports/${third.report.id}/removal`, {
    headers: third.reporter.headers, data: fix(northOf(inside, 16)),
  })
  expect(removal.status()).toBe(200)
  const after = await activity(request, owner, adoption.adoptionId)
  expect(after.concentrations.reduce((sum, group) => sum + group.reportCount, 0))
    .toBeLessThan(three.concentrations.reduce((sum, group) => sum + group.reportCount, 0))
})
