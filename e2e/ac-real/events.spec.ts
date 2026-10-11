// Server-side rules behind the community-event ACs (Epic 9), proved against
// the real FastAPI + PostGIS stack with its featured-place seed. The browser
// journeys for the same stories run on mocks (e2e/events*.spec.ts, e2e/ac).
// Needs the Compose stack with `app.cli seed-featured-places` applied.
import { expect, test, type APIRequestContext, type Browser } from '@playwright/test'
import {
  API_URL, makeJpeg, northOf, publishSighting, startProfile, submitReport, waitForScreening, type Session,
} from '../fixtures/real-api'

// Starting an identity can wait out a one-minute limiter window, and the
// completion test waits for a scheduled job.
test.describe.configure({ timeout: 300_000 })

type EventView = Record<string, unknown> & {
  event_id: string; status: string; joined_count: number; land_status: string; host_display_name: string
}
type Spot = { placeId: string; inside: { lat: number; lng: number }; northEdge: { lat: number; lng: number } }

const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString()
const json = <T,>(response: { json(): Promise<unknown> }) => response.json() as Promise<T>

async function spot(request: APIRequestContext, session: Session, name: string): Promise<Spot> {
  const list = await request.get(`${API_URL}/api/v1/places`, { headers: session.headers, params: { limit: 50 } })
  const match = (await json<{ items: { placeId: string; displayName: string }[] }>(list)).items.find((place) => place.displayName === name)
  test.skip(!match, `The featured place "${name}" is not seeded in this environment.`)
  const detail = await json<{ geometry: { coordinates: number[][][][] } }>(
    await request.get(`${API_URL}/api/v1/places/${match!.placeId}`, { headers: session.headers }))
  const ring = detail.geometry.coordinates[0][0]
  const lngs = ring.map((corner) => corner[0])
  const lats = ring.map((corner) => corner[1])
  const within = (low: number, high: number) => low + (high - low) * (0.3 + Math.random() * 0.4)
  return {
    placeId: match!.placeId,
    inside: { lat: within(Math.min(...lats), Math.max(...lats)), lng: within(Math.min(...lngs), Math.max(...lngs)) },
    northEdge: { lat: Math.max(...lats), lng: (Math.min(...lngs) + Math.max(...lngs)) / 2 },
  }
}

/** An identity allowed to host. With the three-sighting gate switched on it
 *  earns its sightings first; with the gate off any identity qualifies. */
async function hostSession(request: APIRequestContext, browser: Browser) {
  const session = await startProfile(request)
  const eligibility = await json<{ eligible: boolean; report_count: number; required: number }>(
    await request.get(`${API_URL}/api/v1/events/host-eligibility`, { headers: session.headers }))
  for (let count = eligibility.report_count; !eligibility.eligible && count < eligibility.required; count++) {
    await publishSighting(request, browser, session, { lat: 3.6 + Math.random() * 0.3, lng: 101.9 + Math.random() * 0.3 })
  }
  return session
}

function draft(place: Spot, overrides: Record<string, unknown> = {}) {
  return {
    placeId: place.placeId, eventType: 'survey', title: `AC survey ${crypto.randomUUID().slice(0, 8)}`,
    purpose: 'Record invasive plants along the main path.', targetSpeciesIds: ['mikania-micrantha'],
    meetingLatitude: place.inside.lat, meetingLongitude: place.inside.lng,
    startAt: minutesFromNow(-5), endAt: minutesFromNow(120),
    safetyNotes: 'Stay on marked paths. Observe and report only.',
    ...overrides,
  }
}

const createEvent = (request: APIRequestContext, host: Session, body: Record<string, unknown>) =>
  request.post(`${API_URL}/api/v1/events`, { headers: host.headers, data: body })
const patchEvent = (request: APIRequestContext, session: Session, eventId: string, body: Record<string, unknown>) =>
  request.patch(`${API_URL}/api/v1/events/${eventId}`, { headers: session.headers, data: body })
const viewEvent = (request: APIRequestContext, session: Session, eventId: string) =>
  request.get(`${API_URL}/api/v1/events/${eventId}`, { headers: session.headers })

async function publishedEvent(request: APIRequestContext, host: Session, place: Spot, overrides: Record<string, unknown> = {}) {
  const created = await createEvent(request, host, draft(place, overrides))
  expect(created.status(), await created.text()).toBe(201)
  const { event_id: eventId } = await json<{ event_id: string }>(created)
  const published = await patchEvent(request, host, eventId, { status: 'published' })
  expect(published.status(), await published.text()).toBe(200)
  return eventId
}

async function discoveryIds(request: APIRequestContext, placeId?: string) {
  const url = placeId ? `${API_URL}/api/v1/places/${placeId}/events` : `${API_URL}/api/v1/events`
  const response = await request.get(url)
  expect(response.status()).toBe(200)
  return (await json<{ items: EventView[] }>(response)).items
}

const checkIn = (request: APIRequestContext, session: Session, eventId: string, point: { lat: number; lng: number }, accuracyM = 10) =>
  request.post(`${API_URL}/api/v1/events/${eventId}/check-in`, {
    headers: session.headers, data: { latitude: point.lat, longitude: point.lng, accuracyM, capturedAt: new Date().toISOString() },
  })

const cancel = (request: APIRequestContext, session: Session, eventId: string) =>
  request.delete(`${API_URL}/api/v1/events/${eventId}`, { headers: session.headers })

test('AC 9.6.1 Only the host can manage an event', async ({ request, browser }) => {
  const newcomer = await startProfile(request)
  const place = await spot(request, newcomer, 'Taman Tugu')
  const host = await hostSession(request, browser)
  const eventId = await publishedEvent(request, host, place)
  expect((await patchEvent(request, newcomer, eventId, { title: 'Taken over' })).status()).toBe(403)
  expect((await cancel(request, newcomer, eventId)).status()).toBe(403)
  expect((await cancel(request, host, eventId)).status()).toBe(204)
})

test('AC 9.6.1 Hosting unlocks after three sightings', async ({ request, browser }) => {
  const newcomer = await startProfile(request)
  const place = await spot(request, newcomer, 'Taman Tugu')
  const eligibility = await json<{ eligible: boolean; report_count: number; required: number }>(
    await request.get(`${API_URL}/api/v1/events/host-eligibility`, { headers: newcomer.headers }))
  expect(eligibility).toMatchObject({ report_count: 0, required: 3 })
  // EVENT_HOST_GATE_ENABLED is off by default for internal testing, and with
  // it off the server lets a newcomer host, so the lock cannot be observed.
  test.skip(eligibility.eligible, 'The hosting gate is switched off here (EVENT_HOST_GATE_ENABLED=false).')

  const locked = await createEvent(request, newcomer, draft(place))
  expect(locked.status()).toBe(403)
  expect((await json<{ code: string }>(locked)).code).toBe('hosting_locked')
  // Two sightings are not enough; the third unlocks hosting.
  for (let count = 1; count <= 3; count++) {
    await publishSighting(request, browser, newcomer, { lat: 3.6 + Math.random() * 0.3, lng: 101.9 + Math.random() * 0.3 })
    const attempt = await createEvent(request, newcomer, draft(place))
    expect(attempt.status(), `after ${count} sighting(s)`).toBe(count < 3 ? 403 : 201)
    if (attempt.status() === 201) await cancel(request, newcomer, (await json<{ event_id: string }>(attempt)).event_id)
  }
})

test('AC 9.6.2, AC 9.6.3 Host is shown by display name only, and place and time are validated', async ({ request, browser }) => {
  const host = await hostSession(request, browser)
  const place = await spot(request, host, 'Taman Tugu')

  const backwards = await createEvent(request, host, draft(place, { startAt: minutesFromNow(60), endAt: minutesFromNow(30) }))
  expect(backwards.status()).toBe(422)
  expect(JSON.stringify(await backwards.json())).toMatch(/end_at must be after start_at|invalid_event_time/)
  const longPast = await createEvent(request, host, draft(place, { startAt: minutesFromNow(-600), endAt: minutesFromNow(60) }))
  expect((await json<{ code: string }>(longPast)).code).toBe('event_start_in_past')
  const unknownPlace = await createEvent(request, host, draft(place, { placeId: '00000000-0000-4000-8000-000000000000' }))
  expect(unknownPlace.status()).toBe(422)
  expect((await json<{ code: string }>(unknownPlace)).code).toBe('invalid_place')
  const noTitle = await createEvent(request, host, draft(place, { title: '' }))
  expect(noTitle.status()).toBe(422)
  // The meeting point has to be at the chosen place.
  const elsewhere = northOf(place.northEdge, 5000)
  const wrongSpot = await createEvent(request, host, draft(place, { meetingLatitude: elsewhere.lat, meetingLongitude: elsewhere.lng }))
  expect(wrongSpot.status()).toBe(422)

  const eventId = await publishedEvent(request, host, place)
  const viewer = await startProfile(request)
  const detail = await json<EventView>(await viewEvent(request, viewer, eventId))
  // No display name was set, so the fallback is the generic label, never the private ID.
  expect(detail.host_display_name).toBe('Community host')
  expect(JSON.stringify(detail)).not.toContain(host.profile.id)
  await cancel(request, host, eventId)
})

test('AC 9.6.4, AC 9.6.5, AC 9.1.1, AC 9.1.2 Drafts stay private, publishing needs safety notes, and discovery lists only published upcoming events at a place', async ({ request, browser }) => {
  const host = await hostSession(request, browser)
  const stranger = await startProfile(request)
  const place = await spot(request, host, 'Perdana Botanical Garden')

  const created = await createEvent(request, host, draft(place, { safetyNotes: null }))
  expect(await json<{ status: string }>(created)).toMatchObject({ status: 'draft' })
  const { event_id: eventId } = await json<{ event_id: string }>(created)
  const listed = async () => (await discoveryIds(request)).map((event) => event.event_id)
  expect(await listed()).not.toContain(eventId)
  expect((await viewEvent(request, stranger, eventId)).status()).toBe(404)
  expect((await viewEvent(request, host, eventId)).status()).toBe(200)

  const unsafe = await patchEvent(request, host, eventId, { status: 'published' })
  expect(unsafe.status()).toBe(422)
  expect((await json<{ code: string }>(unsafe)).code).toBe('safety_notes_required')
  expect(await listed()).not.toContain(eventId)

  await patchEvent(request, host, eventId, { safetyNotes: 'Stay on marked paths.' })
  expect((await patchEvent(request, host, eventId, { status: 'published' })).status()).toBe(200)
  const entry = (await discoveryIds(request)).find((event) => event.event_id === eventId)!
  expect(entry).toMatchObject({ status: 'published', place_id: place.placeId, community_label: 'Community event - not expert validated' })
  expect(entry.place_name).toBeTruthy()
  // AC 9.1.2 / 9.1.6: the same event through its place.
  expect((await discoveryIds(request, place.placeId)).map((event) => event.event_id)).toContain(eventId)
  const otherPlace = await spot(request, host, 'KLCC Park')
  expect((await discoveryIds(request, otherPlace.placeId)).map((event) => event.event_id)).not.toContain(eventId)
  // Everything listed is published and has not ended.
  for (const event of await discoveryIds(request)) {
    expect(event.status).toBe('published')
    expect(Date.parse(event.end_at as string)).toBeGreaterThan(Date.now())
  }

  expect((await cancel(request, host, eventId)).status()).toBe(204)
  expect(await listed()).not.toContain(eventId)
})

test('AC 9.6.6, AC 9.6.7 Land status comes from mapped data and removal events need land mapped as not protected', async ({ request, browser }) => {
  const host = await hostSession(request, browser)
  const place = await spot(request, host, 'Taman Tugu')
  const land = await json<{ land_status: string }>(
    await request.get(`${API_URL}/api/v1/places/${place.placeId}/land-status`, { headers: host.headers }))
  expect(['protected', 'not_protected', 'uncertain']).toContain(land.land_status)

  // The client's own claim of permission is ignored.
  const created = await createEvent(request, host, draft(place, { permissionContext: 'explicit_permission' }))
  const { event_id: eventId } = await json<{ event_id: string }>(created)
  const detail = await json<EventView>(await viewEvent(request, host, eventId))
  expect(detail.land_status).toBe(land.land_status)

  const removal = await createEvent(request, host, draft(place, { eventType: 'removal' }))
  if (land.land_status === 'not_protected') {
    expect(removal.status()).toBe(201)
    await cancel(request, host, (await json<{ event_id: string }>(removal)).event_id)
  } else {
    // Protected or uncertain fails closed.
    expect(removal.status()).toBe(422)
    expect((await json<{ code: string }>(removal)).code).toBe('removal_not_allowed_here')
    expect((await patchEvent(request, host, eventId, { eventType: 'removal' })).status()).toBe(422)
  }
  await cancel(request, host, eventId)
})

test('AC 9.2.2, AC 9.2.3, AC 9.2.5, AC 9.2.6 Joining is anonymous and idempotent, participation is private, and the chat link is for participants', async ({ request, browser }) => {
  const host = await hostSession(request, browser)
  const place = await spot(request, host, 'Taman Tasik Titiwangsa')
  const insecure = await createEvent(request, host, draft(place, { chatLink: 'http://chat.example.org/group' }))
  expect(insecure.status()).toBe(422)
  const eventId = await publishedEvent(request, host, place, { chatLink: 'https://chat.example.org/group' })

  const member = await startProfile(request)
  const outsider = await startProfile(request)
  const join = () => request.post(`${API_URL}/api/v1/events/${eventId}/participants`, { headers: member.headers })
  // No body at all: the session is the only identity.
  const first = await join()
  expect(first.status()).toBe(201)
  const again = await join()
  expect(again.ok()).toBe(true)

  const asMember = await json<EventView>(await viewEvent(request, member, eventId))
  expect(asMember).toMatchObject({ is_joined: true, joined_count: 1, chat_link: 'https://chat.example.org/group' })
  const asOutsider = await json<EventView>(await viewEvent(request, outsider, eventId))
  expect(asOutsider).toMatchObject({ is_joined: false, joined_count: 1, chat_link: null })
  // An aggregate count only: no participant list and no identity of host or member.
  const publicText = JSON.stringify(asOutsider)
  expect(asOutsider).not.toHaveProperty('participants')
  expect(publicText).not.toContain(member.profile.id)
  expect(publicText).not.toContain(host.profile.id)
  expect((await json<EventView>(await viewEvent(request, host, eventId))).chat_link).toBe('https://chat.example.org/group')

  const withdrawn = await request.delete(`${API_URL}/api/v1/events/${eventId}/participants/${asMember.participation_id}`, { headers: member.headers })
  expect(withdrawn.status()).toBe(204)
  expect(await json<EventView>(await viewEvent(request, member, eventId))).toMatchObject({ is_joined: false, joined_count: 0, chat_link: null })
  // Rejoining reuses the one participation record.
  expect((await join()).status()).toBe(201)
  const rejoined = await json<EventView>(await viewEvent(request, member, eventId))
  expect(rejoined).toMatchObject({ is_joined: true, joined_count: 1, participation_id: asMember.participation_id })
  await cancel(request, host, eventId)
})

test('AC 9.3.2, AC 9.3.3 Check-in is validated on the server and a rejected check-in stores nothing', async ({ request, browser }) => {
  const host = await hostSession(request, browser)
  const place = await spot(request, host, 'Bukit Jalil Recreational Park')
  const eventId = await publishedEvent(request, host, place)
  const later = await publishedEvent(request, host, place, { startAt: minutesFromNow(240), endAt: minutesFromNow(300) })
  const visitor = await startProfile(request)

  const rejected = [
    [await checkIn(request, visitor, eventId, northOf(place.northEdge, 3000)), 'outside_place'],
    [await checkIn(request, visitor, eventId, place.inside, 400), 'accuracy_too_low'],
    [await checkIn(request, visitor, later, place.inside), 'outside_time_window'],
  ] as const
  for (const [response, code] of rejected) {
    expect(response.status()).toBe(422)
    expect((await json<{ code: string }>(response)).code).toBe(code)
  }
  // Nothing was written: no participation and no check-in.
  expect(await json<EventView>(await viewEvent(request, visitor, eventId))).toMatchObject({ is_joined: false, joined_count: 0, last_checkin_at: null })

  const accepted = await checkIn(request, visitor, eventId, place.inside)
  expect(accepted.status()).toBe(201)
  const after = await json<EventView>(await viewEvent(request, visitor, eventId))
  // A successful check-in also joins.
  expect(after).toMatchObject({ is_joined: true, joined_count: 1 })
  expect(after.last_checkin_at).toBeTruthy()
  await cancel(request, host, eventId)
  await cancel(request, host, later)
})

test('AC 9.4.1, AC 9.4.2, AC 9.4.4, AC 9.4.5 An event report needs a check-in, the right place and time, and is tagged and labelled', async ({ request, browser }) => {
  const host = await hostSession(request, browser)
  const place = await spot(request, host, 'Bukit Nanas Forest Reserve')
  const eventId = await publishedEvent(request, host, place)
  const participant = await startProfile(request)
  const tagged = (extra: Record<string, unknown> = {}) => ({ eventId, capturedAt: new Date().toISOString(), ...extra })
  const code = async (response: { json(): Promise<unknown> }) => (await json<{ code: string }>(response)).code

  // Not checked in yet.
  const early = await submitReport(request, participant, { photo: await makeJpeg(browser), location: place.inside, report: tagged() })
  expect(early.response.status()).toBe(422)
  expect(await code(early.response)).toBe('checkin_required')
  // AC 9.4.1: the stored scan on its own created no report.
  const none = await json<{ items: unknown[] }>(await request.get(`${API_URL}/api/v1/reports/mine`, { headers: participant.headers }))
  expect(none.items).toEqual([])

  expect((await checkIn(request, participant, eventId, place.inside)).status()).toBe(201)
  const noTime = await submitReport(request, participant, { photo: await makeJpeg(browser), location: place.inside, report: { eventId } })
  expect(await code(noTime.response)).toBe('captured_at_required')
  const beforeStart = await submitReport(request, participant, {
    photo: await makeJpeg(browser), location: place.inside, report: tagged({ capturedAt: minutesFromNow(-180) }),
  })
  expect(await code(beforeStart.response)).toBe('captured_at_outside_event')
  const offSite = await submitReport(request, participant, {
    photo: await makeJpeg(browser), location: northOf(place.northEdge, 3000), report: tagged(),
  })
  expect(await code(offSite.response)).toBe('outside_place')

  const accepted = await submitReport(request, participant, { photo: await makeJpeg(browser), location: place.inside, report: tagged() })
  expect(accepted.response.status(), await accepted.response.text()).toBe(201)
  const stored = await json<{ id: string; eventId: string; evidenceLabel: string; submission: { capturedAt: string } }>(accepted.response)
  expect(stored).toMatchObject({ eventId, evidenceLabel: 'community_reported' })
  expect(stored.submission.capturedAt).toBeTruthy()
  const screened = await waitForScreening(request, participant, stored.id)
  expect(screened).toMatchObject({ status: 'screened', eventId, evidenceLabel: 'community_reported' })

  // An ordinary report from the same person carries no event link.
  const ordinary = await submitReport(request, participant, { photo: await makeJpeg(browser), location: northOf(place.northEdge, 3000) })
  expect(await json<Record<string, unknown>>(ordinary.response)).not.toHaveProperty('eventId')
  await cancel(request, host, eventId)
})

test('AC 9.4.3, AC 9.4.6 Event reports keep duplicate screening and use the event budget instead of the default throttle', async ({ request, browser }) => {
  const host = await hostSession(request, browser)
  const place = await spot(request, host, 'Rimba Ilmu Woodland (UM)')
  const eventId = await publishedEvent(request, host, place)
  const participant = await startProfile(request)
  expect((await checkIn(request, participant, eventId, place.inside)).status()).toBe(201)

  // AC 9.4.3: the same photo cannot be counted for the event twice.
  const photo = await makeJpeg(browser)
  const tagged = () => ({ eventId, capturedAt: new Date().toISOString() })
  const first = await submitReport(request, participant, { photo, location: place.inside, report: tagged() })
  expect(first.response.status(), await first.response.text()).toBe(201)
  const original = await waitForScreening(request, participant, (await json<{ id: string }>(first.response)).id)
  const replay = await submitReport(request, participant, { photo, location: place.inside, report: tagged() })
  expect((await json<{ id: string }>(replay.response)).id).toBe(original.id)
  const mine = await json<{ items: { id: string }[] }>(await request.get(`${API_URL}/api/v1/reports/mine`, { headers: participant.headers }))
  expect(mine.items.map((item) => item.id)).toEqual([original.id])

  // AC 9.4.6: the default throttle stops an identity at ten attempts in ten
  // minutes. Twelve event-tagged attempts are not throttled (they fail only
  // because their photo key was never issued), while the same identity's
  // untagged attempts still are. The 60-report ceiling itself is covered by
  // backend/tests/test_events_reports.py.
  const attempt = (extra: Record<string, unknown>) => request.post(`${API_URL}/api/v1/reports`, {
    headers: { ...participant.headers, 'Idempotency-Key': `ac-946-${crypto.randomUUID()}` },
    data: {
      photoKey: `uploads/ac-946-${crypto.randomUUID()}.jpg`, speciesId: 'mikania-micrantha', outcome: 'target', confidence: 0.91,
      modelVersion: 'oe_v4_31class_web_fp16', observedAt: new Date().toISOString(), captureId: crypto.randomUUID(),
      captureSource: 'camera', imageSha256: 'b'.repeat(64), location: place.inside, locationAccuracyM: 12,
      extent: 'single', consent: { accurate: true, noPII: true }, ...extra,
    },
  })
  for (let index = 0; index < 12; index++) expect((await attempt(tagged())).status()).not.toBe(429)
  const statuses: number[] = []
  for (let index = 0; index < 11; index++) statuses.push((await attempt({})).status())
  expect(statuses.at(-1)).toBe(429)
  await cancel(request, host, eventId)
})

test('AC 9.7.1, AC 9.7.2 Cancelling keeps the evidence, and one identity can host at most three active events', async ({ request, browser }) => {
  const host = await hostSession(request, browser)
  const place = await spot(request, host, 'FRIM Kepong')
  const eventId = await publishedEvent(request, host, place)
  const participant = await startProfile(request)
  expect((await checkIn(request, participant, eventId, place.inside)).status()).toBe(201)
  const submitted = await submitReport(request, participant, {
    photo: await makeJpeg(browser), location: place.inside, report: { eventId, capturedAt: new Date().toISOString() },
  })
  const report = await waitForScreening(request, participant, (await json<{ id: string }>(submitted.response)).id)
  expect(report.status).toBe('screened')

  // AC 9.7.2: with this one, three more reach the cap of three active events.
  const second = await publishedEvent(request, host, place, { startAt: minutesFromNow(200), endAt: minutesFromNow(260) })
  const third = await publishedEvent(request, host, place, { startAt: minutesFromNow(300), endAt: minutesFromNow(360) })
  const fourth = await createEvent(request, host, draft(place, { startAt: minutesFromNow(400), endAt: minutesFromNow(460) }))
  const overCap = fourth.status() === 201
    ? await patchEvent(request, host, (await json<{ event_id: string }>(fourth)).event_id, { status: 'published' })
    : fourth
  expect(overCap.ok()).toBe(false)
  expect((await json<{ code: string }>(overCap)).code).toBe('event_host_cap_exceeded')

  // AC 9.7.1: soft, idempotent cancel.
  expect((await cancel(request, host, eventId)).status()).toBe(204)
  expect((await cancel(request, host, eventId)).status()).toBe(204)
  expect((await discoveryIds(request)).map((event) => event.event_id)).not.toContain(eventId)
  const cancelled = await json<EventView>(await viewEvent(request, participant, eventId))
  expect(cancelled.status).toBe('cancelled')
  // Attendance and the report survive.
  expect(cancelled.last_checkin_at).toBeTruthy()
  const kept = await json<{ status: string; eventId: string; sightingId: string }>(
    await request.get(`${API_URL}/api/v1/reports/${report.id}`, { headers: participant.headers }))
  expect(kept).toMatchObject({ status: 'screened', eventId })
  expect((await request.get(`${API_URL}/api/v1/sightings/${kept.sightingId}`)).status()).toBe(200)
  // A cancelled event no longer takes joins or check-ins.
  expect((await request.post(`${API_URL}/api/v1/events/${eventId}/participants`, { headers: participant.headers })).status()).toBe(409)
  await cancel(request, host, second)
  await cancel(request, host, third)
})

test('AC 9.7.3, AC 9.7.5 Three distinct flags hide an event, and its host can review and restore it', async ({ request, browser }) => {
  const host = await hostSession(request, browser)
  const place = await spot(request, host, 'Taman Botani Negara Shah Alam')
  const eventId = await publishedEvent(request, host, place)
  const flag = (session: Session) => request.post(`${API_URL}/api/v1/events/${eventId}/flag`, {
    headers: session.headers, data: { reason: 'Meeting point looks unsafe.' },
  })

  expect((await flag(host)).status()).toBe(403)
  const noReason = await request.post(`${API_URL}/api/v1/events/${eventId}/flag`, { headers: (await startProfile(request)).headers, data: { reason: '' } })
  expect(noReason.status()).toBe(422)

  const [one, two, three] = [await startProfile(request), await startProfile(request), await startProfile(request)]
  expect(await json(await flag(one))).toEqual({ flagged: true, hidden: false })
  // The same identity flagging again does not count twice.
  expect(await json(await flag(one))).toEqual({ flagged: true, hidden: false })
  expect(await json(await flag(two))).toEqual({ flagged: true, hidden: false })
  expect(await json(await flag(three))).toEqual({ flagged: true, hidden: true })

  // Hidden from everyone but its host.
  expect((await discoveryIds(request)).map((event) => event.event_id)).not.toContain(eventId)
  expect((await viewEvent(request, one, eventId)).status()).toBe(404)
  const hostView = await json<EventView>(await viewEvent(request, host, eventId))
  expect(hostView).toMatchObject({ hidden: true, can_restore: true, chat_link: null })

  // AC 9.7.5: the host restores it, which clears the tally.
  const restored = await patchEvent(request, host, eventId, { restore: true })
  expect(restored.status(), await restored.text()).toBe(200)
  expect((await discoveryIds(request)).map((event) => event.event_id)).toContain(eventId)
  expect(await json(await flag(one))).toEqual({ flagged: true, hidden: false })
  // Restore is only for a hidden event.
  expect((await json<{ code: string }>(await patchEvent(request, host, eventId, { restore: true }))).code).toBe('event_not_hidden')
  await cancel(request, host, eventId)
})

test('AC 9.7.4, AC 9.5.1, AC 9.5.2, AC 9.5.4 An ended event completes on its own and its summary is factual', async ({ request, browser }) => {
  // The completion job runs inside the API only with RUN_WORKERS_IN_API=true,
  // at EVENT_COMPLETION_INTERVAL_SECONDS (60 at the fastest). Set
  // REAL_EVENT_LIFECYCLE=1 when the stack is started that way.
  test.skip(process.env.REAL_EVENT_LIFECYCLE !== '1', 'Needs a stack running the event lifecycle job; set REAL_EVENT_LIFECYCLE=1.')
  const host = await hostSession(request, browser)
  const place = await spot(request, host, 'Taman Pertanian Malaysia Bukit Cahaya')
  // Everything slow happens before the short event exists, so its few seconds
  // of life are spent on the check-in and the report.
  const participant = await startProfile(request)
  const photo = await makeJpeg(browser)
  const next = await publishedEvent(request, host, place, { startAt: minutesFromNow(600), endAt: minutesFromNow(660) })
  const endsAt = Date.now() + 30_000
  const eventId = await publishedEvent(request, host, place, { endAt: new Date(endsAt).toISOString() })
  expect((await checkIn(request, participant, eventId, place.inside)).status()).toBe(201)
  const submitted = await submitReport(request, participant, {
    photo, location: place.inside, report: { eventId, capturedAt: new Date().toISOString() },
  })
  expect(submitted.response.status(), await submitted.response.text()).toBe(201)
  await waitForScreening(request, participant, (await json<{ id: string }>(submitted.response)).id)

  // Before it ends there is no summary.
  const tooSoon = await request.get(`${API_URL}/api/v1/events/${eventId}/summary`, { headers: participant.headers })
  expect((await json<{ code: string }>(tooSoon)).code).toBe('event_not_completed')
  // The host cannot complete it by hand either.
  expect((await patchEvent(request, host, eventId, { status: 'completed' })).ok()).toBe(false)

  await expect.poll(async () => (await json<EventView>(await viewEvent(request, participant, eventId))).status, {
    timeout: 150_000, intervals: [5_000],
  }).toBe('completed')
  expect(Date.now()).toBeGreaterThan(endsAt)
  expect((await discoveryIds(request)).map((event) => event.event_id)).not.toContain(eventId)

  const summary = await json<Record<string, unknown> & { next_event: { event_id: string; start_at: string } }>(
    await request.get(`${API_URL}/api/v1/events/${eventId}/summary`, { headers: participant.headers }))
  expect(summary).toMatchObject({
    event_id: eventId, reports_submitted_count: 1, distinct_species_count: 1, place_id: place.placeId,
  })
  // AC 9.5.4: the next survey is the earliest future published event at this
  // place. A persistent stack can hold one from an earlier run that starts
  // before ours, so check it against the place's own listing.
  const upcomingHere = (await discoveryIds(request, place.placeId))
    .filter((event) => Date.parse(event.start_at as string) > Date.now())
    .sort((a, b) => Date.parse(a.start_at as string) - Date.parse(b.start_at as string))
  expect(upcomingHere.map((event) => event.event_id)).toContain(next)
  expect(summary.next_event.event_id).toBe(upcomingHere[0].event_id)
  // Counts only: no score, health or treatment outcome.
  expect(Object.keys(summary).join(' ')).not.toMatch(/score|health|cleared|eradicat|improv|success/i)
  // Reports and check-ins outlive completion.
  expect((await json<EventView>(await viewEvent(request, participant, eventId))).last_checkin_at).toBeTruthy()
  await cancel(request, host, next)
})
