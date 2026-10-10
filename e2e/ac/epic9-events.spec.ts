// Epic 9 (community survey events): one test per acceptance criterion that the
// journey specs (events, events-audit, iteration3-audit, report-event) do not
// already assert. Most tests stub the events API at the browser context, so
// they prove what the app sends and shows; rules the server owns (geometry,
// uniqueness, caps, scheduled jobs) are marked in a comment on the test.
import { expect, test, type BrowserContext, type Page, type Request } from '@playwright/test'
import path from 'node:path'
import { atLocation, startPrivateAccess } from '../fixtures/app'
import { pickEventTime } from '../fixtures/event-time'

// Events are stored in UTC and shown in local time; pin the zone so the
// expected clock times below are the same on every machine.
test.use({ timezoneId: 'Asia/Kuala_Lumpur' })

// A place the development mock server also knows, so place lookups, adoption
// and the host form's place search work without extra stubs.
const PLACE_ID = '10000000-0000-4000-8000-000000000001'
const PLACE_NAME = 'Bukit Kiara'
const MEETING = { latitude: 3.1497, longitude: 101.6412 }

type Wire = Record<string, unknown>
type Reply = { status?: number; json?: unknown }

/** An event as the API sends it. 08:00–10:00 UTC is 16:00–18:00 in Kuala Lumpur. */
function wire(overrides: Wire = {}): Wire {
  return {
    event_id: 'event-1', title: 'Morning survey', purpose: 'Record observations along the lower loop.',
    event_type: 'survey', status: 'published', place_id: PLACE_ID, place_name: PLACE_NAME, place_type: 'park',
    target_species_ids: ['mikania-micrantha'], meeting_latitude: MEETING.latitude, meeting_longitude: MEETING.longitude,
    meeting_note: null, start_at: '2030-01-01T08:00:00Z', end_at: '2030-01-01T10:00:00Z', safety_notes: null,
    land_status: 'not_protected', protected_area_name: null, host_display_name: 'Community host', joined_count: 0,
    is_joined: false, participation_id: null, is_host: false, hidden: false, last_checkin_at: null, chat_link: null,
    ...overrides,
  }
}

/** An event that is running right now, for check-in and task screens. */
function liveWire(overrides: Wire = {}): Wire {
  const now = Date.now()
  return wire({ start_at: new Date(now - 600_000).toISOString(), end_at: new Date(now + 3_600_000).toISOString(), ...overrides })
}

/**
 * Answers every /api/v1/events request from one handler. context.route() is
 * used (never page.route()) because the dev mock service worker forwards these
 * calls to the network, where only a context route can see them.
 */
async function serveEvents(context: BrowserContext, handler: (request: Request, pathname: string) => Reply | undefined) {
  await context.route('**/api/v1/events**', async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    const reply = handler(request, pathname)
      ?? (pathname.endsWith('/host-eligibility') ? { json: { eligible: true, report_count: 3, required: 3 } } : undefined)
      ?? { status: 404, json: { code: 'event_not_found', detail: 'Not found' } }
    if (reply.status === 204) return route.fulfill({ status: 204 })
    return route.fulfill({ status: reply.status ?? 200, json: reply.json })
  })
}

const LAND_OPEN = { land_status: 'not_protected', protected_area_name: null, operator: null, allowed_event_types: ['survey', 'removal', 'monitoring', 'other'], reason: 'Not in a mapped protected area.', disclaimer: 'Mapped status is not removal permission.' }

async function serveLandStatus(context: BrowserContext, status: Wire) {
  await context.route('**/api/v1/places/*/land-status', (route) => route.fulfill({ json: status }))
}

/**
 * Some endpoints (places, reports) are answered by the mock service worker
 * inside the page, where no route can reach them. This rewrites those replies
 * as the page receives them: `merge` is shallow-merged into the JSON body, and
 * `liftEventId` copies a report's event id to the top level, where the real
 * API returns it.
 */
async function rewriteMockReply(page: Page, options: { pattern: string; merge?: Wire; liftEventId?: boolean }) {
  await page.addInitScript(({ pattern, merge, liftEventId }) => {
    const original = window.fetch.bind(window)
    const matcher = new RegExp(pattern)
    window.fetch = async (input, init) => {
      const response = await original(input, init)
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')
      if (method !== 'GET' || !response.ok || !matcher.test(new URL(url, window.location.origin).pathname)) return response
      type Json = Record<string, unknown> & { submission?: { eventId?: string | null }; items?: Json[] }
      const lift = (report: Json): Json => (liftEventId && report.submission?.eventId
        ? { ...report, eventId: report.submission.eventId, evidenceLabel: 'community_reported' } : report)
      const data = await response.clone().json() as Json
      const body = Array.isArray(data.items) ? { ...data, items: data.items.map(lift) } : { ...lift(data), ...merge }
      return new Response(JSON.stringify(body), { status: response.status, headers: { 'content-type': 'application/json' } })
    }
  }, options)
}

async function choosePlace(page: Page) {
  await page.getByLabel('Mapped place').fill('Bukit')
  await page.getByRole('button', { name: /Bukit Kiara/ }).click()
  await expect(page.getByText(/^Meeting point \d/)).toBeVisible()
}

async function fillDetails(page: Page, title = 'Lake survey') {
  await page.getByLabel('Event title').fill(title)
  await page.getByRole('textbox', { name: /^Purpose/ }).fill('Record observations')
  await pickEventTime(page, { hour: 10 })
}

const continueStep = (page: Page) => page.getByRole('button', { name: 'Continue' }).click()

test.describe('Epic 9 with the events API stubbed', () => {
  // Hand /api/v1/events* and the place-scoped event paths to context.route().
  test.beforeEach(async ({ page }) => { await page.addInitScript(() => localStorage.setItem('invatrace.mock.community', 'off')) })

  test('AC 9.1.1 Show only published, upcoming events', async ({ page, context }) => {
    const queries: URL[] = []
    const first = wire({ event_id: 'e-1', title: 'Saturday Mikania survey' })
    const second = wire({ event_id: 'e-2', title: 'Monthly regrowth check', event_type: 'monitoring', place_name: 'Taman Tugu Trail', place_type: 'trail', target_species_ids: [], start_at: '2030-02-03T01:00:00Z', end_at: '2030-02-03T03:30:00Z' })
    await serveEvents(context, (request, pathname) => {
      if (pathname !== '/api/v1/events') return undefined
      queries.push(new URL(request.url()))
      return { json: { items: [first, second] } }
    })
    await startPrivateAccess(page)
    await page.goto('/events')

    // Each card carries title, place, date, time and target species.
    const cards = page.locator('.event-card')
    await expect(cards).toHaveCount(2)
    await expect(cards.nth(0).locator('.event-card__title')).toHaveText('Saturday Mikania survey')
    await expect(cards.nth(0)).toContainText('Bukit Kiara')
    await expect(cards.nth(0)).toContainText('Tue 1 Jan · 16:00–18:00')
    await expect(cards.nth(0).getByLabel('Target species: Mile-a-minute weed')).toBeVisible()
    await expect(cards.nth(1).locator('.event-card__title')).toHaveText('Monthly regrowth check')
    await expect(cards.nth(1)).toContainText('Taman Tugu Trail')
    await expect(cards.nth(1)).toContainText('Sun 3 Feb · 09:00–11:30')

    // The date range goes to the server as a query; the browser does not
    // filter by status or time itself, it shows exactly what came back.
    await page.getByRole('button', { name: 'Next 7 days' }).click()
    await expect.poll(() => queries.some((url) => {
      const to = Date.parse(url.searchParams.get('to') ?? '')
      const days = (to - Date.now()) / 86_400_000
      return days > 6.9 && days < 7.1
    })).toBe(true)
    await expect(cards).toHaveCount(2)
    expect(queries.every((url) => !url.searchParams.has('status'))).toBe(true)

    // Custom dates pick whole days only, and never a day that has passed.
    await page.getByRole('button', { name: 'Custom dates' }).click()
    const calendar = page.getByRole('dialog', { name: 'Choose dates' })
    await expect(calendar.getByRole('button', { name: 'Previous month' })).toBeDisabled()
    await expect(calendar.locator('input')).toHaveCount(0)
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1)
    if (yesterday.getMonth() === new Date().getMonth()) {
      await expect(calendar.locator('.range-calendar__day button').nth(yesterday.getDate() - 1)).toBeDisabled()
    }
  })

  test('AC 9.1.2 Anchor every event to a supported place', async ({ page, context }) => {
    // Stub level: proves the card and detail show the mapped place the API
    // names. That an unresolvable place cannot be published is a server rule,
    // and the marker itself is drawn on a map canvas this test cannot read.
    const item = wire({ event_id: 'e-forest', title: 'Forest edge survey', place_id: '10000000-0000-4000-8000-000000000003', place_name: 'Kota Damansara Community Forest', place_type: 'forest', meeting_latitude: 3.17, meeting_longitude: 101.59 })
    await serveEvents(context, (_request, pathname) => (pathname === '/api/v1/events' ? { json: { items: [item] } } : pathname === '/api/v1/events/e-forest' ? { json: item } : undefined))
    await startPrivateAccess(page)
    await page.goto('/events')
    const card = page.locator('.event-card')
    await expect(card).toContainText('Kota Damansara Community Forest · Forest')
    await expect(page.getByText('Community event meeting point')).toBeVisible()
    await card.getByRole('link').click()
    const meeting = page.locator('.event-meeting')
    await expect(meeting).toContainText('Kota Damansara Community Forest')
    await expect(meeting).toContainText('Forest')
    await expect(page.getByRole('region', { name: 'Meeting point for Forest edge survey at Kota Damansara Community Forest' })).toBeVisible()
  })

  test('AC 9.1.3 Community-survey labelling', async ({ page, context }) => {
    const types = [['survey', 'Community survey'], ['removal', 'Removal activity'], ['monitoring', 'Repeat monitoring'], ['other', 'Other community activity']] as const
    const items = types.map(([type], index) => wire({ event_id: `e-${type}`, title: `Event ${index + 1}`, event_type: type, host_display_name: index === 0 ? 'Aina' : undefined }))
    await serveEvents(context, (_request, pathname) => {
      if (pathname === '/api/v1/events') return { json: { items } }
      const match = items.find((item) => pathname === `/api/v1/events/${String(item.event_id)}`)
      return match ? { json: match } : undefined
    })
    await startPrivateAccess(page)
    await page.goto('/events')
    const cards = page.locator('.event-card')
    await expect(cards).toHaveCount(4)
    for (const [index, [, label]] of types.entries()) {
      await expect(cards.nth(index).locator('.event-type')).toHaveText(label)
      await expect(cards.nth(index).locator('.event-community')).toHaveText('Community activity')
      await expect(cards.nth(index)).toContainText(/Hosted by .+, a community member/)
    }
    // The map key names event markers as their own kind of marker.
    await expect(page.locator('.event-map__legend')).toHaveText('Community event meeting point')

    await cards.nth(1).getByRole('link').click()
    const header = page.locator('.event-detail__header')
    await expect(header.locator('.event-type')).toHaveText('Removal activity')
    await expect(header).toContainText('Community activity · not an official operation')
    await expect(header).toContainText('Hosted by Community host, a community member')
    // Nothing on the page presents the event as an official or authorised programme.
    await expect(page.locator('.events-page')).not.toContainText(/official eradication|eradication programme|government[- ]authori[sz]|authori[sz]ed by/i)
  })

  test('AC 9.1.4 Accessible list fallback', async ({ page, context }) => {
    const first = wire({ event_id: 'e-1', title: 'Saturday Mikania survey' })
    const second = wire({ event_id: 'e-2', title: 'Monthly regrowth check', event_type: 'monitoring', start_at: '2030-02-03T01:00:00Z', end_at: '2030-02-03T03:30:00Z' })
    // "Next 7 days" sends a `to` bound; the stub answers that range with one event.
    await serveEvents(context, (request, pathname) => {
      if (pathname === '/api/v1/events') return { json: { items: new URL(request.url()).searchParams.has('to') ? [first] : [first, second] } }
      return pathname === '/api/v1/events/e-1' ? { json: first } : undefined
    })
    await startPrivateAccess(page)
    await page.goto('/events')

    // The count and the active filter are announced, and the list and the map
    // are drawn from the same result.
    const count = page.locator('.events-count')
    await expect(count).toHaveAttribute('role', 'status')
    await expect(count).toHaveAttribute('aria-live', 'polite')
    await expect(count).toContainText('2 events')
    await expect(count).toContainText('all species · all upcoming')
    const list = page.getByRole('list', { name: 'Upcoming events' })
    await expect(list.getByRole('listitem')).toHaveCount(2)
    await expect(page.getByRole('region', { name: 'Map of 2 upcoming events. The list shows the same events.' })).toBeVisible()

    await page.getByRole('button', { name: 'Next 7 days' }).click()
    await expect(count).toContainText('1 event')
    await expect(count).toContainText('next 7 days')
    await expect(list.getByRole('listitem')).toHaveCount(1)
    await expect(page.getByRole('region', { name: 'Map of 1 upcoming events. The list shows the same events.' })).toBeVisible()

    // The list item is one keyboard-reachable link exposing what the marker stands for.
    const link = list.getByRole('link')
    await expect(link).toContainText('Saturday Mikania survey')
    await expect(link).toContainText('Bukit Kiara')
    await expect(link).toContainText('Tue 1 Jan · 16:00–18:00')
    await expect(link.getByLabel('Target species: Mile-a-minute weed')).toBeVisible()
    await link.focus()
    await expect(link).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/events\/e-1$/)
  })

  test('AC 9.1.6 Surface events for a followed area', async ({ page, context }) => {
    // Stub level: the adopted area asks the place-scoped endpoint and lists
    // what it returns. That the endpoint only returns published, upcoming
    // events is the server's rule.
    const placeRequests: string[] = []
    const item = wire({ event_id: 'e-kiara', title: 'Kiara lower loop survey' })
    await context.route('**/api/v1/places/*/events**', (route) => {
      placeRequests.push(new URL(route.request().url()).pathname)
      return route.fulfill({ json: { items: [item] } })
    })
    await serveEvents(context, (_request, pathname) => (pathname === '/api/v1/events/e-kiara' ? { json: item } : undefined))
    await startPrivateAccess(page)
    await page.evaluate(async (placeId) => {
      const modulePath = '/src/services/api-client.ts'
      const { api } = await import(modulePath)
      await api('/api/v1/adopted-areas', { method: 'POST', body: JSON.stringify({ placeId }) })
    }, PLACE_ID)

    await page.goto('/adopted-areas')
    await expect(page.getByRole('link', { name: 'See events for this area' })).toHaveAttribute('href', `/events?placeId=${PLACE_ID}`)
    await page.getByRole('link', { name: 'Open activity map' }).click()
    const section = page.getByRole('region', { name: 'Upcoming community events here' })
    await expect(section.getByRole('link', { name: /Kiara lower loop survey/ })).toContainText('Community survey · Tue 1 Jan · 16:00–18:00')
    expect(placeRequests).toContain(`/api/v1/places/${PLACE_ID}/events`)

    // The area's events link opens discovery scoped to that one place.
    await page.goto('/adopted-areas')
    await page.getByRole('link', { name: 'See events for this area' }).click()
    await expect(page.getByRole('heading', { name: `Events at ${PLACE_NAME}` })).toBeVisible()
    await expect(page.getByText(`Showing only events at ${PLACE_NAME}.`)).toBeVisible()
    await expect(page.locator('.event-card')).toHaveCount(1)
    await expect(page.locator('.event-card__title')).toHaveText('Kiara lower loop survey')
  })

  test('AC 9.2.1 Complete event detail', async ({ page, context }) => {
    const full = wire({
      title: 'Lakeside survey', purpose: 'Walk the lake path and record every climber on the fence line.',
      meeting_note: 'Main gate, next to the noticeboard', safety_notes: 'Closed shoes. Stay off the water edge.',
      host_display_name: 'Aina', target_species_ids: ['mikania-micrantha'],
    })
    const other = wire({ event_id: 'event-2', title: 'Ridge recheck', purpose: 'Revisit the ridge plots.', start_at: '2030-03-05T00:30:00Z', end_at: '2030-03-05T02:00:00Z', host_display_name: 'Farid' })
    await serveEvents(context, (_request, pathname) => (pathname === '/api/v1/events/event-1' ? { json: full } : pathname === '/api/v1/events/event-2' ? { json: other } : undefined))
    await startPrivateAccess(page)
    await page.goto('/events/event-1')

    await expect(page.getByRole('heading', { name: 'Lakeside survey' })).toBeVisible()
    await expect(page.locator('.event-purpose')).toHaveText('Walk the lake path and record every climber on the fence line.')
    await expect(page.locator('.event-species-list').getByRole('link', { name: 'Mile-a-minute weed' })).toHaveAttribute('href', '/catalogue/mikania-micrantha')
    await expect(page.locator('.event-meeting')).toContainText('Bukit Kiara')
    await expect(page.locator('.event-meeting__note')).toHaveText('Main gate, next to the noticeboard')
    await expect(page.getByRole('region', { name: 'Meeting point for Lakeside survey at Bukit Kiara' })).toBeVisible()
    // Stored 08:00–10:00 UTC, shown as local (UTC+8) time and labelled so.
    const when = page.locator('.event-when')
    await expect(when).toContainText(/Tuesday,? 1 January 2030/)
    await expect(when).toContainText('16:00 – 18:00')
    await expect(when).toContainText('your local time')
    await expect(page.locator('.event-detail__host')).toHaveText('Hosted by Aina, a community member')
    await expect(page.locator('.event-safety__host')).toContainText('Closed shoes. Stay off the water edge.')

    // A second event shows its own record, so none of the above is fixed text.
    await page.goto('/events/event-2')
    await expect(page.getByRole('heading', { name: 'Ridge recheck' })).toBeVisible()
    await expect(page.locator('.event-purpose')).toHaveText('Revisit the ridge plots.')
    await expect(page.locator('.event-when')).toContainText('08:30 – 10:00')
    await expect(page.locator('.event-detail__host')).toHaveText('Hosted by Farid, a community member')
    await expect(page.locator('.event-safety__host')).toHaveCount(0)
  })

  test('AC 9.2.2 Join with the anonymous identity only', async ({ page, context }) => {
    // Stub level: proves what the browser sends and how it reacts to 201 and
    // 409. That the server refuses a join on a non-published event is its rule.
    const joins: Array<{ body: string | null; authorization: string | undefined }> = []
    const open = wire()
    const closed = wire({ event_id: 'event-closed', title: 'Closing survey' })
    await serveEvents(context, (request, pathname) => {
      if (request.method() === 'POST' && pathname === '/api/v1/events/event-1/participants') {
        joins.push({ body: request.postData(), authorization: request.headers().authorization })
        Object.assign(open, { is_joined: true, participation_id: 'participation-1', joined_count: 1 })
        return { status: 201, json: { participation_id: 'participation-1', status: 'joined' } }
      }
      if (request.method() === 'POST' && pathname === '/api/v1/events/event-closed/participants') {
        return { status: 409, json: { code: 'event_not_joinable', detail: 'This event is not open for joining.' } }
      }
      return pathname === '/api/v1/events/event-1' ? { json: open } : pathname === '/api/v1/events/event-closed' ? { json: closed } : undefined
    })
    await startPrivateAccess(page)
    await page.goto('/events/event-1')
    await expect(page.getByText('No name, email or password needed.')).toBeVisible()
    await page.getByRole('button', { name: 'Join this event', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Join Morning survey?' })
    // Joining asks for nothing about the person: the confirmation has no fields.
    await expect(dialog.locator('input, textarea, select')).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Join this event' }).click()
    await expect(page.locator('.event-joined__state')).toHaveText('Joined')
    await expect(page.getByRole('button', { name: 'Join this event', exact: true })).toHaveCount(0)
    // One request, carrying only the session credential: no email, phone, name or password.
    expect(joins).toHaveLength(1)
    expect(joins[0].body ?? '').toBe('')
    expect(joins[0].authorization).toMatch(/^Bearer \S+/)

    // A join the server refuses (the event is no longer published) is not shown as joined.
    await page.goto('/events/event-closed')
    await page.getByRole('button', { name: 'Join this event', exact: true }).click()
    const refused = page.getByRole('dialog', { name: 'Join Closing survey?' })
    await refused.getByRole('button', { name: 'Join this event' }).click()
    await expect(refused.getByRole('alert')).toHaveText('This event is not open for joining.')
    await expect(page.locator('.event-joined__state')).toHaveCount(0)
  })

  test('AC 9.2.5 Private participation', async ({ page, context }) => {
    // Stub level: even if a response carried participant identities, the page
    // shows only the aggregate count. That the public response never contains
    // them is a server rule this cannot prove.
    const leaky = wire({
      joined_count: 4,
      participants: [{ public_id: 'PUB-LEAK-0001', display_name: 'Leaked Participant', recovery_key: 'RECOVERY-LEAK' }],
      participant_public_ids: ['PUB-LEAK-0002'], session_token: 'SESSION-LEAK',
    })
    await serveEvents(context, (_request, pathname) => (pathname === '/api/v1/events/event-1' ? { json: leaky } : undefined))
    await startPrivateAccess(page)
    await page.goto('/events/event-1')
    const going = page.locator('.event-when div').filter({ hasText: 'Going' })
    await expect(going.locator('dd')).toHaveText('4 joined')
    // One aggregate figure: no participant list, and no identifier anywhere on the page.
    await expect(page.locator('.event-action-card').locator('ul, ol, table')).toHaveCount(0)
    await expect(page.getByText(/participants?\b/i)).toHaveCount(0)
    await expect(page.locator('body')).not.toContainText(/PUB-LEAK|Leaked Participant|RECOVERY-LEAK|SESSION-LEAK/)
  })

  test('AC 9.2.6 Optional group-chat link for participants', async ({ page, context }) => {
    // Stub level: the page shows the link only to the host or a joined
    // participant, and never for a hidden or cancelled event, even when the
    // response contains one. The server withholding chat_link is its own rule.
    const link = 'https://chat.example.org/invite/kiara-survey'
    const views: Record<string, Wire> = {
      'as-visitor': wire({ chat_link: link }),
      'as-participant': wire({ chat_link: link, is_joined: true, participation_id: 'p-1' }),
      'as-host': wire({ chat_link: link, is_host: true }),
      'when-cancelled': wire({ chat_link: link, is_joined: true, status: 'cancelled' }),
      'when-hidden': wire({ chat_link: link, is_host: true, hidden: true }),
      'without-link': wire({ chat_link: null, is_joined: true, participation_id: 'p-2' }),
    }
    await serveEvents(context, (_request, pathname) => {
      const id = pathname.split('/').pop() ?? ''
      return views[id] ? { json: { ...views[id], event_id: id } } : undefined
    })
    await startPrivateAccess(page)
    const chat = page.getByRole('link', { name: 'Open the group chat' })

    for (const id of ['as-participant', 'as-host']) {
      await page.goto(`/events/${id}`)
      await expect(chat).toHaveAttribute('href', link)
      // An external link the person chooses to open, marked as outside InvaTrace.
      await expect(chat).toHaveAttribute('target', '_blank')
      await expect(chat).toHaveAttribute('rel', /noopener/)
      await expect(page.locator('.event-chat')).toContainText('Opens outside InvaTrace. The chat is run by the host, not by InvaTrace.')
    }
    // Showing the link never opens it.
    expect(context.pages()).toHaveLength(1)

    for (const id of ['as-visitor', 'when-cancelled', 'when-hidden', 'without-link']) {
      await page.goto(`/events/${id}`)
      await expect(page.getByRole('heading', { name: 'Morning survey' })).toBeVisible()
      await expect(chat).toHaveCount(0)
      await expect(page.locator(`a[href="${link}"]`)).toHaveCount(0)
    }
  })

  test('AC 9.3.2 Server-side time-window and place validation', async ({ page, context, baseURL }) => {
    // Stub level: proves the browser sends the device fix and leaves the
    // verdict to the server. The status, time-window, accuracy and PostGIS
    // membership checks themselves need the real API.
    // A fix about 300 km from the event place: the client must not judge it.
    const fix = { latitude: 5.4141, longitude: 100.3288, accuracy: 12 }
    await atLocation(context, baseURL, fix)
    const bodies: Wire[] = []
    const event = liveWire()
    await serveEvents(context, (request, pathname) => {
      if (request.method() === 'POST' && pathname === '/api/v1/events/event-1/check-in') {
        bodies.push(request.postDataJSON() as Wire)
        Object.assign(event, { is_joined: true, participation_id: 'p-auto', last_checkin_at: new Date().toISOString() })
        return { status: 201, json: { checked_in_at: new Date().toISOString() } }
      }
      return pathname === '/api/v1/events/event-1' ? { json: event } : undefined
    })
    await startPrivateAccess(page)
    await page.goto('/events/event-1/check-in')
    await expect(page.getByText('We check the event time and that you are inside the event place.')).toBeVisible()
    const confirm = page.getByRole('button', { name: 'Confirm check-in' })
    await expect(confirm).toBeEnabled()
    const before = Date.now()
    await confirm.click()
    await expect(page).toHaveURL(/\/events\/event-1\/tasks$/)

    expect(bodies).toHaveLength(1)
    expect(Object.keys(bodies[0]).sort()).toEqual(['accuracyM', 'capturedAt', 'latitude', 'longitude'])
    expect(bodies[0].latitude).toBeCloseTo(fix.latitude, 4)
    expect(bodies[0].longitude).toBeCloseTo(fix.longitude, 4)
    expect(bodies[0].accuracyM).toBe(12)
    // The fix is fresh: taken while this screen was open, not replayed.
    const capturedAt = Date.parse(String(bodies[0].capturedAt))
    expect(capturedAt).toBeGreaterThan(before - 60_000)
    expect(capturedAt).toBeLessThanOrEqual(Date.now() + 1_000)
    // The caller had not joined; the accepted check-in is what made them a participant.
    await page.getByRole('link', { name: 'Back to event', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Withdraw', exact: true })).toBeVisible()
  })

  test('AC 9.3.3 Rejected check-in is explained, not stored', async ({ page, context, baseURL }) => {
    // Stub level: each machine-readable code is explained by its condition and
    // never treated as a check-in. That nothing is written on the server needs
    // the real API.
    await atLocation(context, baseURL, { ...MEETING, accuracy: 400 })
    let code = ''
    let attempts = 0
    await serveEvents(context, (request, pathname) => {
      if (request.method() === 'POST' && pathname === '/api/v1/events/event-1/check-in') {
        attempts += 1
        return { status: 422, json: { code, detail: 'Rejected.' } }
      }
      return pathname === '/api/v1/events/event-1' ? { json: liveWire() } : undefined
    })
    await startPrivateAccess(page)
    await page.goto('/events/event-1/check-in')
    const confirm = page.getByRole('button', { name: 'Confirm check-in' })

    // Accuracy worse than 250 m never reaches the server.
    await expect(page.locator('.event-accuracy')).toContainText('±400 m')
    await expect(page.locator('.event-accuracy')).toContainText('Needs 250 m or better')
    await expect(confirm).toBeDisabled()
    await context.setGeolocation({ ...MEETING, accuracy: 10 })
    await page.getByRole('button', { name: 'Get a new location' }).click()
    await expect(page.locator('.event-accuracy')).toContainText('Within the 250 m limit')

    const rejection = page.getByRole('alert').filter({ hasText: 'You have not been checked in.' })
    const cases = [
      ['location_unavailable', 'Location:', 'Your location is unavailable'],
      ['accuracy_too_low', 'Accuracy:', 'not accurate enough'],
      ['outside_place', 'Place:', 'outside the mapped event place'],
      ['outside_time_window', 'Timing:', 'Check-in opens 30 minutes before the event starts and closes when it ends.'],
    ] as const
    for (const [index, [next, condition, message]] of cases.entries()) {
      code = next
      await confirm.click()
      await expect(rejection).toContainText(condition)
      await expect(rejection).toContainText(message)
      expect(attempts).toBe(index + 1)
      // Still on check-in, with no local record of a check-in.
      await expect(page).toHaveURL(/\/check-in$/)
      await expect(page.locator('.event-checked-in')).toHaveCount(0)
      expect(await page.evaluate(() => localStorage.getItem('invatrace.active-event.v1'))).toBeNull()
    }
    // The task screen agrees: this identity has not checked in.
    await page.goto('/events/event-1/tasks')
    await expect(page.getByRole('heading', { name: 'Check in first' })).toBeVisible()
  })

  test('AC 9.3.4 Session task view after check-in', async ({ page, context }) => {
    const checkedIn = { last_checkin_at: new Date().toISOString(), is_joined: true, participation_id: 'p-1' }
    const events: Record<string, Wire> = {
      survey: liveWire({ event_id: 'survey', event_type: 'survey', ...checkedIn }),
      removal: liveWire({ event_id: 'removal', event_type: 'removal', ...checkedIn }),
      monitoring: liveWire({ event_id: 'monitoring', event_type: 'monitoring', ...checkedIn }),
    }
    await serveEvents(context, (_request, pathname) => {
      const match = events[pathname.split('/').pop() ?? '']
      return match ? { json: match } : undefined
    })
    await startPrivateAccess(page)

    // Every type: a clear scan action, the plants to record, and the
    // identification-uncertainty and permission guidance kept in view.
    const everyType = async () => {
      await expect(page.getByRole('link', { name: 'Start a scan' })).toHaveAttribute('href', '/scan')
      await expect(page.getByRole('list', { name: 'Plants to look for' }).getByRole('link', { name: /Mile-a-minute weed/ })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Identification is a prediction' })).toBeVisible()
      await expect(page.locator('.event-safety')).toContainText('is not permission to remove any plant or to enter restricted land')
    }

    await page.goto('/events/survey/tasks')
    await expect(page.getByRole('heading', { name: 'Find and record' })).toBeVisible()
    await expect(page.locator('.event-task__list')).toContainText('Scan each possible plant and compare it with the reference photos.')
    // A survey carries no removal steps.
    await expect(page.locator('.event-task')).not.toContainText(/Removal and disposal/)
    await everyType()

    await page.goto('/events/removal/tasks')
    await expect(page.getByRole('heading', { name: 'Removal activity — permission first' })).toBeVisible()
    await expect(page.locator('.event-task__list')).toContainText('It checks the protected-area boundary and asks whether the land manager has given you permission.')
    await expect(page.locator('.event-task__list')).toContainText('Removal and disposal steps appear there only after those checks pass, for you, at that spot.')
    await expect(page.locator('.event-safety')).toContainText('Joining this removal event is not permission')
    await everyType()

    await page.goto('/events/monitoring/tasks')
    await expect(page.getByRole('heading', { name: 'Repeat monitoring' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Show sightings that need a follow-up' })).toHaveAttribute('href', '/map?status=followup-needed')
    await expect(page.locator('.event-task')).not.toContainText(/Removal and disposal/)
    await everyType()

    // Once checked in, the event leads to the task, not to another check-in.
    await page.getByRole('link', { name: 'Back to event', exact: true }).click()
    await expect(page.getByRole('link', { name: 'Open today’s task' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Check in at the event' })).toHaveCount(0)
  })

  test('AC 9.5.1 Factual event summary', async ({ page, context }) => {
    // Stub level: the page shows the server's counts, place and dates. Which
    // reports the server counts (screened, tagged, captured in the window) is
    // its own rule.
    const summaries: Record<string, Wire> = {
      'event-1': { reports_submitted_count: 7, distinct_species_count: 3, place_id: PLACE_ID, place_name: PLACE_NAME, start_at: '2030-01-01T08:00:00Z', end_at: '2030-01-01T10:00:00Z', next_event: null },
      'event-2': { reports_submitted_count: 12, distinct_species_count: 5, place_id: PLACE_ID, place_name: 'Taman Tugu Trail', start_at: '2030-02-03T01:00:00Z', end_at: '2030-02-03T03:30:00Z', next_event: null },
    }
    await serveEvents(context, (_request, pathname) => {
      const [, id] = /\/events\/([^/]+)\/summary$/.exec(pathname) ?? []
      return summaries[id] ? { json: summaries[id] } : undefined
    })
    await startPrivateAccess(page)
    const stat = (label: string) => page.locator('.event-stats div').filter({ hasText: label }).locator('dd')

    await page.goto('/events/event-1/summary')
    await expect(page.getByRole('heading', { name: 'What this event recorded' })).toBeVisible()
    await expect(stat('Screened reports submitted')).toHaveText('7')
    await expect(stat('Different species recorded')).toHaveText('3')
    await expect(page.locator('.event-detail__host')).toHaveText('Bukit Kiara · Tue 1 Jan · 16:00–18:00')
    await expect(page.getByText(/Counts of community reports captured during the event, excluding rejected or deleted ones/)).toBeVisible()
    // The figures are read-only: nobody types them in.
    await expect(page.locator('.events-page').locator('input, textarea')).toHaveCount(0)

    await page.goto('/events/event-2/summary')
    await expect(stat('Screened reports submitted')).toHaveText('12')
    await expect(stat('Different species recorded')).toHaveText('5')
    await expect(page.locator('.event-detail__host')).toHaveText('Taman Tugu Trail · Sun 3 Feb · 09:00–11:30')
  })

  test('AC 9.5.2 Monitoring language, not outcome claims', async ({ page, context }) => {
    await serveEvents(context, (_request, pathname) => (pathname.endsWith('/summary')
      ? { json: { reports_submitted_count: 40, distinct_species_count: 6, place_id: PLACE_ID, place_name: PLACE_NAME, start_at: '2030-01-01T08:00:00Z', end_at: '2030-01-01T10:00:00Z', next_event: null } }
      : undefined))
    await startPrivateAccess(page)
    await page.goto('/events/event-1/summary')
    await expect(page.locator('.event-detail__header .event-community')).toHaveText('Community survey activity')
    // Exactly two figures, both plain counts: no combined or derived score.
    await expect(page.locator('.event-stats dt')).toHaveText(['Screened reports submitted', 'Different species recorded'])
    await expect(page.locator('.event-stats dd')).toHaveText(['40', '6'])
    const outcomeClaim = /improv|eradicat|recover|density|health|score|success|cleared|%/i
    for (const heading of await page.locator('.events-page').locator('h2, h3, dt').allTextContents()) {
      expect(heading).not.toMatch(outcomeClaim)
    }
    // Health and density are named once, only to say the counts are not that.
    await expect(page.getByText('They describe activity only — not expert-verified, and not a measure of the place’s health, invasion density or removal.')).toBeVisible()
    await expect(page.locator('.events-page')).not.toContainText(/improv|eradicat|recover|score|success|%/i)
    expect(await page.locator('.events-page').innerText()).toMatch(/^(?:(?!health|density)[\s\S])*not a measure of the place’s health, invasion density(?:(?!health|density)[\s\S])*$/)
  })

  test('AC 9.5.3 Adopt the area from the summary', async ({ page, context }) => {
    await serveEvents(context, (_request, pathname) => (pathname.endsWith('/summary')
      ? { json: { reports_submitted_count: 2, distinct_species_count: 1, place_id: PLACE_ID, place_name: PLACE_NAME, start_at: '2030-01-01T08:00:00Z', end_at: '2030-01-01T10:00:00Z', next_event: null } }
      : undefined))
    // The adoption itself is answered by the mock service worker, so the
    // request is observed rather than routed.
    const adoptions: Wire[] = []
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/adopted-areas') adoptions.push(request.postDataJSON() as Wire)
    })
    await startPrivateAccess(page)
    await page.goto('/events/event-1/summary')
    await expect(page.getByRole('heading', { name: `Keep watching ${PLACE_NAME}` })).toBeVisible()
    await expect(page.getByText('A shared bookmark — no ownership or removal permission.')).toBeVisible()
    await page.getByRole('button', { name: 'Follow this area for monitoring' }).click()
    const adopted = page.locator('.event-follow').getByRole('button', { name: 'Adopted' })
    await expect(adopted).toBeDisabled()
    // The existing Epic 6 endpoint, with the summary's place and nothing else.
    expect(adoptions).toEqual([{ placeId: PLACE_ID }])

    // The place is now one of this identity's monitoring areas.
    await page.goto('/adopted-areas')
    await expect(page.getByRole('heading', { name: PLACE_NAME })).toBeVisible()
    // And the summary remembers it.
    await page.goto('/events/event-1/summary')
    await expect(page.locator('.event-follow').getByRole('button', { name: 'Adopted' })).toBeDisabled()
  })

  test('AC 9.5.4 Surface the next survey', async ({ page, context }) => {
    // Stub level: a next event is linked when the server names one; otherwise
    // the page invites following the area. That next_event is always a real
    // published future event is the server's rule.
    const base = { reports_submitted_count: 2, distinct_species_count: 1, place_id: PLACE_ID, place_name: PLACE_NAME, start_at: '2030-01-01T08:00:00Z', end_at: '2030-01-01T10:00:00Z' }
    const next = wire({ event_id: 'event-next', title: 'February survey', start_at: '2030-02-03T01:00:00Z', end_at: '2030-02-03T03:30:00Z' })
    await serveEvents(context, (_request, pathname) => {
      if (pathname === '/api/v1/events/with-next/summary') return { json: { ...base, next_event: { event_id: 'event-next', start_at: next.start_at } } }
      if (pathname === '/api/v1/events/without-next/summary') return { json: { ...base, next_event: null } }
      return pathname === '/api/v1/events/event-next' ? { json: next } : undefined
    })
    await startPrivateAccess(page)

    await page.goto('/events/without-next/summary')
    const section = page.locator('.event-section').filter({ has: page.getByRole('heading', { name: 'Next survey here' }) })
    await expect(section).toContainText('No later event has been published for this place yet. Follow the area to keep an eye on it')
    await expect(page.getByRole('button', { name: 'Follow this area for monitoring' })).toBeVisible()
    // No placeholder: nothing in the section links to an event.
    await expect(section.locator('a[href^="/events/"]:not([href="/events/host"])')).toHaveCount(0)
    await expect(page.locator('.event-next')).toHaveCount(0)

    await page.goto('/events/with-next/summary')
    const link = page.locator('.event-next')
    await expect(link).toHaveAttribute('href', '/events/event-next')
    await expect(link).toContainText(/Sunday,? 3 February 2030 · 09:00/)
    await link.click()
    await expect(page.getByRole('heading', { name: 'February survey' })).toBeVisible()
  })

  test('AC 9.6.2 Host shown by optional display name only', async ({ page, context }) => {
    // Stub level: the page shows the display name or "Community host" and
    // nothing else about the host, even if the response carried more. The
    // public response never exposing those values is a server rule.
    const secrets = { host_public_id: 'IT-HOST-PUBLIC-7Q2', host_identity_id: '7f0c1d2e-aaaa-4bbb-8ccc-111122223333', host_recovery_key: 'HOST-RECOVERY-KEY' }
    const named = wire({ event_id: 'named', title: 'Named host survey', host_display_name: 'Aina', ...secrets })
    const unnamed = wire({ event_id: 'unnamed', title: 'Unnamed host survey', host_display_name: null, ...secrets })
    const blank = wire({ event_id: 'blank', title: 'Blank host survey', host_display_name: '   ', ...secrets })
    const all = [named, unnamed, blank]
    await serveEvents(context, (_request, pathname) => {
      if (pathname === '/api/v1/events') return { json: { items: all } }
      const match = all.find((item) => pathname === `/api/v1/events/${String(item.event_id)}`)
      return match ? { json: match } : undefined
    })
    await startPrivateAccess(page)
    await page.goto('/events')
    const hosts = page.locator('.event-card__host')
    await expect(hosts).toHaveText(['Hosted by Aina, a community member', 'Hosted by Community host, a community member', 'Hosted by Community host, a community member'])
    await expect(page.locator('body')).not.toContainText(/IT-HOST-PUBLIC|7f0c1d2e|HOST-RECOVERY/)

    await page.goto('/events/named')
    await expect(page.locator('.event-detail__host')).toHaveText('Hosted by Aina, a community member')
    await page.goto('/events/unnamed')
    await expect(page.locator('.event-detail__host')).toHaveText('Hosted by Community host, a community member')
    await expect(page.locator('body')).not.toContainText(/IT-HOST-PUBLIC|7f0c1d2e|HOST-RECOVERY/)
    // The join confirmation and the task link reuse the same event, with no host identifier.
    await page.getByRole('button', { name: 'Join this event', exact: true }).click()
    await expect(page.getByRole('dialog')).not.toContainText(/IT-HOST-PUBLIC|7f0c1d2e|HOST-RECOVERY/)
  })

  test('AC 9.6.3 Valid place and time required', async ({ page, context }) => {
    // Stub level: the form's own defaults and checks, and that a 422 from the
    // server is shown and nothing is published. The PostGIS meeting-point test
    // and the stored geometry_version need the real API.
    // An L-shaped place: the centre of its bounding box (101.645, 3.155) is outside it.
    const lShape = { type: 'Polygon', coordinates: [[[101.63, 3.14], [101.66, 3.14], [101.66, 3.15], [101.64, 3.15], [101.64, 3.17], [101.63, 3.17], [101.63, 3.14]]] }
    await rewriteMockReply(page, { pattern: `^/api/v1/places/${PLACE_ID}$`, merge: { geometry: lShape } })
    await serveLandStatus(context, LAND_OPEN)
    const posts: Wire[] = []
    const outside = wire({ event_id: 'draft-outside', status: 'draft', is_host: true, meeting_latitude: 3.155, meeting_longitude: 101.645 })
    await serveEvents(context, (request, pathname) => {
      if (request.method() === 'POST' && pathname === '/api/v1/events') {
        posts.push(request.postDataJSON() as Wire)
        return { status: 422, json: { code: 'meeting_point_outside_place', detail: 'Meeting point is outside the event place.' } }
      }
      return pathname === '/api/v1/events/draft-outside' ? { json: outside } : undefined
    })
    await startPrivateAccess(page)

    // The default meeting point is inside the place, not at the bounding-box centre.
    await page.goto('/events/host')
    await choosePlace(page)
    const [, lat, lng] = /Meeting point (\d+\.\d+), (\d+\.\d+)/.exec(await page.locator('.host-coordinates').innerText()) ?? []
    const latitude = Number(lat), longitude = Number(lng)
    const inLowerArm = longitude > 101.63 && longitude < 101.66 && latitude > 3.14 && latitude < 3.15
    const inUpperArm = longitude > 101.63 && longitude < 101.64 && latitude > 3.14 && latitude < 3.17
    expect(inLowerArm || inUpperArm).toBe(true)

    // The time picker only produces an end after the start, and that is what is sent.
    await continueStep(page)
    await fillDetails(page)
    await continueStep(page)
    await page.getByRole('button', { name: 'Publish event' }).click()
    // A 422 from the server is shown and the host stays on the form.
    await expect(page.getByRole('alert').filter({ hasText: 'Meeting point is outside the event place.' })).toBeVisible()
    await expect(page).toHaveURL(/\/events\/host$/)
    expect(posts).toHaveLength(1)
    expect(posts[0].placeId).toBe(PLACE_ID)
    expect(Date.parse(String(posts[0].endAt))).toBeGreaterThan(Date.parse(String(posts[0].startAt)))

    // A meeting point outside the boundary is flagged before the host can continue.
    await page.goto('/events/draft-outside/edit')
    await expect(page.getByRole('heading', { name: /^Step 1 of 3/ })).toBeVisible()
    await expect(page.getByText('Meeting point 3.15500, 101.64500')).toBeVisible()
    await continueStep(page)
    await expect(page.getByRole('alert').filter({ hasText: 'Move the meeting point inside the dashed boundary — check-in only works inside the place.' })).toBeVisible()
    await expect(page.getByRole('heading', { name: /^Step 1 of 3/ })).toBeVisible()
  })

  test('AC 9.6.4 Draft before public', async ({ page, context }) => {
    // Stub level: saving creates a draft without publishing, and publishing is
    // a separate explicit PATCH. Drafts being absent from every discovery
    // endpoint is a server rule.
    await serveLandStatus(context, LAND_OPEN)
    const writes: Array<{ method: string; pathname: string; body: Wire }> = []
    const saved = wire({ event_id: 'draft-1', title: 'Lake survey', status: 'draft', is_host: true })
    await serveEvents(context, (request, pathname) => {
      if (request.method() === 'POST' || request.method() === 'PATCH') writes.push({ method: request.method(), pathname, body: request.postDataJSON() as Wire })
      if (request.method() === 'POST' && pathname === '/api/v1/events') return { status: 201, json: { event_id: 'draft-1', status: 'draft' } }
      if (request.method() === 'PATCH' && pathname === '/api/v1/events/draft-1') {
        const body = request.postDataJSON() as Wire
        if (body.status) saved.status = body.status
        return { json: saved }
      }
      if (pathname === '/api/v1/events/mine') return { json: { items: [saved] } }
      return pathname === '/api/v1/events/draft-1' ? { json: saved } : undefined
    })
    await startPrivateAccess(page)
    await page.goto('/events/host')
    await expect(page.getByText(/It stays a private draft until you publish it\./)).toBeVisible()
    await choosePlace(page)
    await continueStep(page)
    await fillDetails(page)
    await continueStep(page)
    await page.getByRole('button', { name: 'Save draft' }).click()

    // One create, no publish: the event exists only as a private draft.
    await expect(page).toHaveURL(/\/events\/draft-1$/)
    expect(writes.map((write) => `${write.method} ${write.pathname}`)).toEqual(['POST /api/v1/events'])
    expect(writes[0].body).not.toHaveProperty('status')
    await expect(page.getByText('Private draft — nobody else can find this event until you publish it.')).toBeVisible()
    // A draft cannot be joined, checked into or reported.
    await expect(page.getByRole('button', { name: 'Join this event', exact: true })).toHaveCount(0)
    await page.goto('/events/mine')
    await expect(page.locator('.event-status')).toHaveText('Draft')

    // Publishing is the host's explicit action on the draft.
    await page.getByRole('link', { name: 'Edit' }).click()
    await continueStep(page)
    await continueStep(page)
    await page.getByRole('button', { name: 'Publish event' }).click()
    await expect(page).toHaveURL(/\/events\/draft-1$/)
    expect(writes).toHaveLength(2)
    expect(`${writes[1].method} ${writes[1].pathname}`).toBe('PATCH /api/v1/events/draft-1')
    expect(writes[1].body.status).toBe('published')
    await expect(page.getByText(/Private draft/)).toHaveCount(0)
  })

  test('AC 9.6.5 Safe-by-default event content', async ({ page, context }) => {
    await serveLandStatus(context, LAND_OPEN)
    const posts: Wire[] = []
    const published = wire({ event_id: 'safe-1', title: 'Lake survey', safety_notes: 'Observe and report by default. Wear closed shoes.', land_status: 'protected', protected_area_name: 'Bukit Kiara Forest Reserve', target_species_ids: [] })
    await serveEvents(context, (request, pathname) => {
      if (request.method() === 'POST' && pathname === '/api/v1/events') { posts.push(request.postDataJSON() as Wire); return { status: 201, json: { event_id: 'safe-1', status: 'draft' } } }
      return pathname === '/api/v1/events/safe-1' ? { json: published } : undefined
    })
    await startPrivateAccess(page)
    await page.goto('/events/host')
    await choosePlace(page)
    // Removal is available on this land, yet observe-and-report is the default.
    await expect(page.getByRole('radio', { name: /Removal activity/ })).toBeVisible()
    await expect(page.getByRole('radio', { name: /Community survey/ })).toBeChecked()
    const selfDeclared = /I have permission|permission from the land ?manager|land ?manager(?:’|')s permission|I am the land ?manager|I own/i
    await expect(page.locator('.host-event').locator('input[type="checkbox"]')).toHaveCount(0)
    await expect(page.locator('.host-event')).not.toContainText(selfDeclared)
    await continueStep(page)

    // Safety notes start from an observe-and-report default.
    await expect(page.getByLabel('Safety notes')).toHaveValue(/^Observe and report by default\./)
    await expect(page.locator('.host-event').locator('input[type="checkbox"]')).toHaveCount(0)
    await fillDetails(page)
    await continueStep(page)
    await expect(page.locator('.host-review')).toContainText('Hosting or joining an event never grants permission to remove plants. The default activity is to observe and report.')
    await expect(page.locator('.host-review')).toContainText('Not in a mapped protected area')
    await expect(page.locator('.host-event').locator('input[type="checkbox"]')).toHaveCount(0)
    await expect(page.locator('.host-event')).not.toContainText(selfDeclared)
    await page.getByRole('button', { name: 'Save draft' }).click()
    await expect(page).toHaveURL(/\/events\/safe-1$/)
    // The host sent safety notes and a survey, and declared nothing about permission or land status.
    expect(posts).toHaveLength(1)
    expect(posts[0].eventType).toBe('survey')
    expect(String(posts[0].safetyNotes)).toMatch(/^Observe and report by default\./)
    expect(Object.keys(posts[0]).filter((key) => /permission|land/i.test(key))).toEqual([])

    // The event carries its safety notes and the server's land status, and
    // keeps the permission guidance one tap away.
    const safety = page.locator('.event-detail__main .event-safety')
    await expect(safety.locator('.event-safety__host')).toContainText('Observe and report by default. Wear closed shoes.')
    await expect(safety).toContainText('This place overlaps a mapped protected area (Bukit Kiara Forest Reserve). Observe and report only.')
    await expect(safety).toContainText('is not permission to remove any plant or to enter restricted land')
    await safety.getByRole('link', { name: 'Open safe-response guidance in the plant catalogue' }).click()
    await expect(page).toHaveURL(/\/catalogue$/)
  })

  test('AC 9.6.6 Choose the event type and matching guidance', async ({ page, context }) => {
    // Stub level: removal is offered where the land status allows it, the
    // chosen type is what is sent, and a server refusal is shown. The server's
    // re-check on create, change and publish needs the real API.
    await serveLandStatus(context, LAND_OPEN)
    const posts: Wire[] = []
    const removal = wire({ event_id: 'removal-1', title: 'Fence-line removal', event_type: 'removal' })
    await serveEvents(context, (request, pathname) => {
      if (request.method() === 'POST' && pathname === '/api/v1/events') {
        posts.push(request.postDataJSON() as Wire)
        return { status: 422, json: { code: 'removal_not_allowed_here', detail: 'Only survey, monitoring or other observe-and-report activities can be hosted at this place.' } }
      }
      return pathname === '/api/v1/events/removal-1' ? { json: removal } : undefined
    })
    await startPrivateAccess(page)
    await page.goto('/events/host')
    // Place first: no type can be chosen until the place's land status is known.
    await expect(page.getByRole('radio')).toHaveCount(0)
    await choosePlace(page)
    await expect(page.locator('.host-land-status')).toContainText('Not in a mapped protected area')
    await expect(page.locator('.event-type-picker').getByRole('radio')).toHaveCount(4)
    for (const label of [/Community survey/, /Removal activity/, /Repeat monitoring/, /Other community activity/]) {
      await expect(page.getByRole('radio', { name: label })).toBeVisible()
    }
    await page.getByRole('radio', { name: /Removal activity/ }).check()
    await expect(page.locator('.event-type-picker')).toContainText('Each person still passes the safety checks on the day.')
    await continueStep(page)
    await fillDetails(page, 'Fence-line removal')
    await continueStep(page)
    await expect(page.locator('.host-review')).toContainText('Fence-line removal · Removal activity')
    await page.getByRole('button', { name: 'Publish event' }).click()
    await expect.poll(() => posts.length).toBe(1)
    expect(posts[0].eventType).toBe('removal')
    // The server re-checks the land status; its refusal is shown and nothing is published.
    await expect(page.getByRole('alert').filter({ hasText: 'Only survey, monitoring or other observe-and-report activities can be hosted at this place.' })).toBeVisible()
    await expect(page).toHaveURL(/\/events\/host$/)

    // A published removal event shows its type, and still grants no removal permission.
    await page.goto('/events/removal-1')
    await expect(page.locator('.event-detail__header .event-type')).toHaveText('Removal activity')
    await expect(page.locator('.event-type-guidance')).toContainText('Joining does not give permission to remove plants.')
    await expect(page.locator('.event-detail__main .event-safety')).toContainText('Joining this removal event is not permission to remove any plant or to enter restricted land.')
  })

  test('AC 9.6.7 Land status comes from mapped data, not self-declaration', async ({ page, context }) => {
    // Stub level: how each mapped status is presented and that an uncertain
    // one fails closed. The PostGIS intersection that derives the status needs
    // the real API. The protected case is asserted in events-audit.spec.ts.
    await serveLandStatus(context, { land_status: 'uncertain', protected_area_name: null, operator: null, allowed_event_types: ['survey', 'monitoring', 'other'], reason: 'Protected-area status could not be confirmed.', disclaimer: 'Mapped status is not removal permission.' })
    const stored: Record<string, Wire> = {
      protected: wire({ event_id: 'protected', land_status: 'protected', protected_area_name: 'Kota Damansara Forest Reserve' }),
      open: wire({ event_id: 'open', land_status: 'not_protected' }),
      uncertain: wire({ event_id: 'uncertain', land_status: 'uncertain' }),
    }
    await serveEvents(context, (_request, pathname) => {
      const match = stored[pathname.split('/').pop() ?? '']
      return match ? { json: match } : undefined
    })
    await startPrivateAccess(page)
    await page.goto('/events/host')
    await choosePlace(page)
    const card = page.locator('.host-land-status')
    await expect(card).toContainText('Protected-area status unknown')
    await expect(card).toContainText('Surveys, monitoring and other observe-and-report events only — no removal.')
    await expect(card).toContainText('Mapped status isn’t removal permission — everyone still passes the safety checks on the day.')
    // Uncertain fails closed: removal is not offered at all.
    await expect(page.getByRole('radio', { name: /Removal activity/ })).toHaveCount(0)
    await expect(page.locator('.event-type-picker').getByRole('radio')).toHaveCount(3)
    // The host is told the status; there is nowhere to state it themselves.
    await expect(page.locator('.host-event').locator('select, input[type="checkbox"]')).toHaveCount(0)

    // The status stored on an event is shown on its detail page, with the area's name.
    const safety = page.locator('.event-detail__main .event-safety')
    await page.goto('/events/protected')
    await expect(safety).toContainText('This place overlaps a mapped protected area (Kota Damansara Forest Reserve). Observe and report only.')
    await page.goto('/events/open')
    await expect(safety).toContainText('This place is not in a mapped protected area. That is not ownership or access permission — confirm the site rules yourself before acting.')
    await page.goto('/events/uncertain')
    await expect(safety).toContainText('The protected-area status of this place could not be confirmed. Observe and report only.')
  })

  test('AC 9.7.1 Cancel without destroying evidence', async ({ page, context }) => {
    // Stub level: cancelling is one DELETE on the event, the host is told what
    // is kept, and the cancelled event still shows its history. That reports
    // and participant records survive in the database needs the real API.
    const writes: string[] = []
    const hosted = wire({ event_id: 'hosted-1', title: 'Lake survey', is_host: true, joined_count: 2 })
    await serveEvents(context, (request, pathname) => {
      if (request.method() !== 'GET') writes.push(`${request.method()} ${pathname}`)
      if (request.method() === 'DELETE' && pathname === '/api/v1/events/hosted-1') { hosted.status = 'cancelled'; return { status: 204 } }
      if (pathname === '/api/v1/events/mine') return { json: { items: [hosted] } }
      if (pathname === '/api/v1/events') return { json: { items: hosted.status === 'published' ? [hosted] : [] } }
      return pathname === '/api/v1/events/hosted-1' ? { json: hosted } : undefined
    })
    await startPrivateAccess(page)
    await page.goto('/events/mine')
    await expect(page.locator('.event-status')).toHaveText('Published')
    await page.getByRole('button', { name: 'Cancel event' }).click()
    const dialog = page.getByRole('dialog', { name: 'Cancel Lake survey?' })
    await expect(dialog).toContainText('The event leaves discovery and nobody new can join or check in. Reports already submitted and the people who joined are kept.')
    await dialog.getByRole('button', { name: 'Cancel event' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.locator('.event-status')).toHaveText('Cancelled')
    // A soft cancel of the event only: nothing is sent to remove participants or reports.
    expect(writes).toEqual(['DELETE /api/v1/events/hosted-1'])
    // A cancelled event cannot be edited or cancelled again.
    await expect(page.getByRole('button', { name: 'Cancel event' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Edit' })).toHaveCount(0)

    // Its page says the history is kept, and still shows the people who joined.
    await page.locator('.event-card').getByRole('link').click()
    await expect(page.getByText('This event has been cancelled. Its attendance and report history are kept.')).toBeVisible()
    await expect(page.locator('.event-when')).toContainText('2 joined')
    await expect(page.getByRole('button', { name: 'Join this event', exact: true })).toHaveCount(0)
    // It has left discovery.
    await page.goto('/events')
    await expect(page.getByRole('heading', { name: 'No upcoming survey events found here' })).toBeVisible()
  })

  test('AC 9.7.2 Bounded hosting to limit abuse', async ({ page, context }) => {
    // Stub level: the 429 and its explanation reach the host and nothing else
    // changes. The per-identity cap itself is enforced by the real API.
    await serveLandStatus(context, LAND_OPEN)
    const CAP = 'You already have 3 upcoming hosted events. Cancel one or wait for one to finish before adding another. Your existing events are unchanged.'
    const writes: string[] = []
    const existing = [1, 2, 3].map((n) => wire({ event_id: `mine-${n}`, title: `Hosted event ${n}`, is_host: true }))
    await serveEvents(context, (request, pathname) => {
      if (request.method() !== 'GET') writes.push(`${request.method()} ${pathname}`)
      if (request.method() === 'POST' && pathname === '/api/v1/events') return { status: 429, json: { code: 'event_host_cap_exceeded', detail: CAP } }
      return pathname === '/api/v1/events/mine' ? { json: { items: existing } } : undefined
    })
    await startPrivateAccess(page)
    await page.goto('/events/host')
    await choosePlace(page)
    await continueStep(page)
    await fillDetails(page, 'A fourth event')
    await continueStep(page)
    await page.getByRole('button', { name: 'Publish event' }).click()
    await expect(page.getByRole('alert').filter({ hasText: CAP })).toBeVisible()
    // The host stays on the form with their entries; nothing was published.
    await expect(page).toHaveURL(/\/events\/host$/)
    await expect(page.locator('.host-review')).toContainText('A fourth event')
    expect(writes).toEqual(['POST /api/v1/events'])

    // The existing events are untouched.
    await page.goto('/events/mine')
    await expect(page.locator('.event-card__title')).toHaveText(['Hosted event 1', 'Hosted event 2', 'Hosted event 3'])
    await expect(page.locator('.event-status')).toHaveText(['Published', 'Published', 'Published'])
  })

  test('AC 9.7.3 Report a concerning event', async ({ page, context }) => {
    // Stub level: the flag a viewer sends, and what a hidden event looks like
    // to the public and to its host. One flag per identity and hiding at the
    // third distinct flag are counted by the real API.
    const flags: Wire[] = []
    const views: Record<string, Wire> = {
      'event-1': wire(),
      'hosted-hidden': wire({ event_id: 'hosted-hidden', title: 'Hidden survey', is_host: true, hidden: true, can_restore: true, joined_count: 3 }),
      hosted: wire({ event_id: 'hosted', is_host: true }),
    }
    await serveEvents(context, (request, pathname) => {
      if (request.method() === 'POST' && pathname === '/api/v1/events/event-1/flag') {
        flags.push(request.postDataJSON() as Wire)
        return { json: { flagged: true, hidden: false } }
      }
      const match = views[pathname.split('/').pop() ?? '']
      return match ? { json: match } : undefined
    })
    await startPrivateAccess(page)
    await page.goto('/events/event-1')
    await page.getByRole('button', { name: 'Report this event' }).click()
    const dialog = page.getByRole('dialog', { name: 'Report this event' })
    await expect(dialog).toContainText('Reports are anonymous. An event is hidden for review after several different people report it.')
    // A reason is required before anything is sent.
    const send = dialog.getByRole('button', { name: 'Send report' })
    await expect(send).toBeDisabled()
    await dialog.getByRole('radio', { name: 'Encourages unsafe or unpermitted removal' }).check()
    await dialog.getByLabel('Details (optional)').fill('Tells people to pull plants inside the reserve.')
    await send.click()
    await expect(page.getByText('Thanks — your report was recorded.')).toBeVisible()
    expect(flags).toEqual([{ reason: 'Encourages unsafe or unpermitted removal — Tells people to pull plants inside the reserve.' }])
    // One report per viewing: the control is replaced, not offered again.
    await expect(page.getByRole('button', { name: 'Report this event' })).toHaveCount(0)

    // A host cannot report their own event.
    await page.goto('/events/hosted')
    await expect(page.getByRole('heading', { name: 'Morning survey' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Report this event' })).toHaveCount(0)

    // Hidden pending review: the host still sees the event and its participants,
    // but it takes no new joins or check-ins.
    await page.goto('/events/hosted-hidden')
    await expect(page.getByText(/This event is hidden after community safety reports\./)).toBeVisible()
    await expect(page.locator('.event-when')).toContainText('3 joined')
    await expect(page.getByRole('button', { name: 'Join this event', exact: true })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Check in at the event' })).toHaveCount(0)
    await page.goto('/events/hosted-hidden/check-in')
    await expect(page.getByText('This event is not open for check-in. It may have ended, been cancelled or been hidden for review.')).toBeVisible()

    // Everyone else gets "not available" (the API answers 404 for a hidden event).
    await page.goto('/events/hidden-for-others')
    await expect(page.getByText('This event is not available. It may be a private draft or hidden for review.')).toBeVisible({ timeout: 30_000 })
  })

  test('AC 9.7.4 Events auto-complete after they end', async ({ page, context }) => {
    // Stub level: what a completed event and its summary look like, and that
    // the summary is withheld until completion. The scheduled job that moves an
    // ended event to completed runs only inside the API process.
    const completed = wire({ event_id: 'done', title: 'Finished survey', status: 'completed', start_at: '2026-01-01T08:00:00Z', end_at: '2026-01-01T10:00:00Z', joined_count: 5, is_joined: true, participation_id: 'p-1' })
    await serveEvents(context, (_request, pathname) => {
      if (pathname === '/api/v1/events') return { json: { items: [] } }
      if (pathname === '/api/v1/events/done') return { json: completed }
      if (pathname === '/api/v1/events/done/summary') return { json: { reports_submitted_count: 9, distinct_species_count: 4, place_id: PLACE_ID, place_name: PLACE_NAME, start_at: completed.start_at, end_at: completed.end_at, next_event: null } }
      if (pathname === '/api/v1/events/running/summary') return { status: 409, json: { code: 'event_not_completed', detail: 'Summary is available after completion.' } }
      return undefined
    })
    await startPrivateAccess(page)
    await page.goto('/events/done')
    await expect(page.locator('.event-banner')).toContainText('This event has ended.')
    // Completed with no host action: nothing left to join, check into or report against.
    await expect(page.getByRole('button', { name: 'Join this event', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Withdraw', exact: true })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Check in at the event' })).toHaveCount(0)
    // Its attendance is preserved and its summary is now available.
    await expect(page.locator('.event-when')).toContainText('5 joined')
    await expect(page.getByRole('link', { name: 'View event summary' })).toHaveAttribute('href', '/events/done/summary')
    await page.getByRole('link', { name: 'See what it recorded' }).click()
    await expect(page).toHaveURL(/\/events\/done\/summary$/)
    await expect(page.locator('.event-stats dd')).toHaveText(['9', '4'])

    // Before completion there is no summary.
    await page.goto('/events/running/summary')
    await expect(page.getByText('The summary is available once the event has ended.')).toBeVisible({ timeout: 30_000 })
  })

  test('AC 9.7.5 Resolve a hidden event', async ({ page, context }) => {
    // Stub level: the host is told their event is hidden and about the 14-day
    // window, and can restore or cancel it. Clearing the flag tally and the
    // 14-day auto-cancel job belong to the real API.
    const writes: Array<{ call: string; body: unknown }> = []
    const hidden = wire({ event_id: 'hidden-1', title: 'Flagged survey', is_host: true, hidden: true, can_restore: true, joined_count: 2 })
    const second = wire({ event_id: 'hidden-2', title: 'Second flagged survey', is_host: true, hidden: true, can_restore: true })
    await serveEvents(context, (request, pathname) => {
      if (request.method() !== 'GET') writes.push({ call: `${request.method()} ${pathname}`, body: request.postDataJSON() as unknown })
      if (request.method() === 'PATCH' && pathname === '/api/v1/events/hidden-1') { Object.assign(hidden, { hidden: false, can_restore: false }); return { json: hidden } }
      if (request.method() === 'DELETE' && pathname === '/api/v1/events/hidden-2') { Object.assign(second, { status: 'cancelled', can_restore: false }); return { status: 204 } }
      if (pathname === '/api/v1/events/mine') return { json: { items: [hidden, second] } }
      return pathname === '/api/v1/events/hidden-1' ? { json: hidden } : undefined
    })
    await startPrivateAccess(page)
    await page.goto('/events/hidden-1')
    await expect(page.getByText('This event is hidden after community safety reports. Review the details in your hosted events before restoring visibility.')).toBeVisible()

    await page.goto('/events/mine')
    await expect(page.getByText('A hidden event is cancelled after 14 days unless you restore or cancel it.')).toBeVisible()
    const rows = page.locator('.events-list--managed > li')
    await expect(rows.nth(0).locator('.event-status')).toHaveText('Published · hidden')
    // Outcome 1: restore. One PATCH asking only for the restore.
    await rows.nth(0).getByRole('button', { name: 'Restore visibility' }).click()
    await expect(rows.nth(0).locator('.event-status')).toHaveText('Published')
    await expect(rows.nth(0).getByRole('button', { name: 'Restore visibility' })).toHaveCount(0)
    expect(writes).toEqual([{ call: 'PATCH /api/v1/events/hidden-1', body: { restore: true } }])
    await expect(rows.nth(0)).toContainText('Flagged survey')

    // Outcome 2: cancel. The same soft cancel as AC 9.7.1, which keeps the history.
    await rows.nth(1).getByRole('button', { name: 'Cancel event' }).click()
    const dialog = page.getByRole('dialog', { name: 'Cancel Second flagged survey?' })
    await expect(dialog).toContainText('Reports already submitted and the people who joined are kept.')
    await dialog.getByRole('button', { name: 'Cancel event' }).click()
    await expect(rows.nth(1).locator('.event-status')).toHaveText('Cancelled · hidden')
    expect(writes.map((write) => write.call)).toEqual(['PATCH /api/v1/events/hidden-1', 'DELETE /api/v1/events/hidden-2'])
    // A host-cancelled event is not offered for restoration.
    await expect(rows.nth(1).getByRole('button', { name: 'Restore visibility' })).toHaveCount(0)
  })
})

test.describe('Epic 9 on the development mock server', () => {
  // These run against the in-page mock of the events and reports API, which
  // mirrors the server's status codes and ownership rules but is not the server.

  /** Fresh identity, checked in to a running event, with a scan carried to the report preview. */
  async function reachEventReportPreview(page: Page, context: BrowserContext, baseURL: string | undefined) {
    await atLocation(context, baseURL, { latitude: 3.1442, longitude: 101.6438, accuracy: 10 })
    const { profile } = await startPrivateAccess(page)
    const now = Date.now()
    const window = { startAt: new Date(now - 3_600_000).toISOString(), endAt: new Date(now + 3_600_000).toISOString() }
    await page.evaluate(({ profileId, startAt, endAt }) => {
      localStorage.setItem('invatrace.active-event.v1', JSON.stringify({ eventId: 'event-1', profileId, startAt, endAt, checkedInAt: new Date().toISOString() }))
      localStorage.setItem('invatrace.development-model-species', 'mikania_micrantha')
    }, { profileId: profile.id, ...window })
    await page.getByRole('button', { name: /Scan a plant|New scan/ }).first().click()
    await page.locator('input[aria-label="Choose photo from gallery"]').setInputFiles(path.join(process.cwd(), 'public/reference-images/mikania-micrantha.jpg'))
    await expect(page.getByText('Photo quality check passed')).toBeVisible()
    await page.getByRole('button', { name: /Analyse plant/ }).click()
    await page.getByRole('button', { name: /Report sighting/ }).click()
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByText('Single plant', { exact: true }).click()
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('checkbox', { name: /accurate/i }).check()
    await page.getByRole('checkbox', { name: /personal information/i }).check()
    await page.getByRole('button', { name: 'Review submission' }).click()
    await expect(page.getByRole('button', { name: 'Submit to this event' })).toBeVisible()
    return window
  }

  /** Bodies of every report submission, read from the page's own requests. */
  function reportBodies(page: Page) {
    const bodies: Wire[] = []
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/reports') bodies.push(request.postDataJSON() as Wire)
    })
    return bodies
  }

  test('AC 9.2.3 Idempotent join and withdraw', async ({ page }) => {
    // Mock level: the journey and the request contract. Uniqueness on
    // (event_id, anonymous_identity_id) and the ownership check on DELETE are
    // enforced by the real API.
    const calls: string[] = []
    page.on('request', (request) => {
      const pathname = new URL(request.url()).pathname
      if (request.method() !== 'GET' && pathname.includes('/participants')) calls.push(`${request.method()} ${pathname}`)
    })
    await startPrivateAccess(page)
    await page.goto('/events/evt-seed-survey')
    const going = page.locator('.event-when div').filter({ hasText: 'Going' }).locator('dd')
    await expect(going).toHaveText('0 joined')
    const join = async () => {
      await page.getByRole('button', { name: 'Join this event', exact: true }).click()
      await page.getByRole('dialog').getByRole('button', { name: 'Join this event' }).click()
      await expect(page.locator('.event-joined__state')).toHaveText('Joined')
    }
    await join()
    await expect(going).toHaveText('1 joined')

    // The same join sent twice more returns the same participation, not new ones.
    const repeated = await page.evaluate(async () => {
      const modulePath = '/src/services/api-client.ts'
      const { api } = await import(modulePath)
      const post = () => api('/api/v1/events/evt-seed-survey/participants', { method: 'POST' }) as Promise<{ participation_id: string }>
      const first = await post(), second = await post()
      const event = await api('/api/v1/events/evt-seed-survey') as { joined_count: number; participation_id: string }
      return { first: first.participation_id, second: second.participation_id, current: event.participation_id, joinedCount: event.joined_count }
    })
    expect(repeated.second).toBe(repeated.first)
    expect(repeated.current).toBe(repeated.first)
    expect(repeated.joinedCount).toBe(1)

    // Withdraw names this identity's own participation and returns the control to Join.
    await page.getByRole('button', { name: 'Withdraw', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Join this event', exact: true })).toBeVisible()
    await expect(going).toHaveText('0 joined')
    expect(calls.at(-1)).toBe(`DELETE /api/v1/events/evt-seed-survey/participants/${repeated.first}`)

    // Joining again re-activates that participation rather than adding a second.
    await join()
    await expect(going).toHaveText('1 joined')
    const rejoined = await page.evaluate(async () => {
      const modulePath = '/src/services/api-client.ts'
      const { api } = await import(modulePath)
      return (await api('/api/v1/events/evt-seed-survey') as { participation_id: string }).participation_id
    })
    expect(rejoined).toBe(repeated.first)
  })

  test('AC 9.4.2 Report is tagged to the event', async ({ page, context, baseURL }) => {
    // Mock level: the explicit event submission carries the event id and the
    // scan's capture time. Storing event_id, and the 422 for an invalid, draft
    // or cancelled event, are the real API's.
    const bodies = reportBodies(page)
    const window = await reachEventReportPreview(page, context, baseURL)
    expect(bodies).toHaveLength(0)
    const created = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/reports')
    await page.getByRole('button', { name: 'Submit to this event' }).click()
    const report = await (await created).json() as { status: string; submission: { eventId?: string } }
    await expect(page.getByRole('heading', { name: 'Report published' })).toBeVisible()

    expect(bodies).toHaveLength(1)
    expect(bodies[0].eventId).toBe('event-1')
    // captured_at is when the photo was taken, inside the event window.
    expect(bodies[0].capturedAt).toBe(bodies[0].observedAt)
    const capturedAt = Date.parse(String(bodies[0].capturedAt))
    expect(capturedAt).toBeGreaterThanOrEqual(Date.parse(window.startAt))
    expect(capturedAt).toBeLessThanOrEqual(Date.parse(window.endAt))
    // It comes back carrying the event, as an ordinary report that is screened like any other.
    expect(report.submission.eventId).toBe('event-1')
    expect(report.status).toBe('processing')
    await expect(page.getByText('Community report - not expert validated')).toBeVisible()
  })

  test('AC 9.4.3 Event-aware duplicate screening', async ({ page, context, baseURL }) => {
    // Mock level: an event submission carries the same exact-image and
    // completeness evidence as an ordinary one, and an exact-image refusal is
    // explained with the scan kept. The per-identity 25 m / 10 min merge is the
    // real API's rule and is not exercised here.
    await page.addInitScript(() => { window.__msw = { reportRejection: { status: 409, code: 'event_report_already_linked', detail: 'This image is already linked to a report.' } } })
    const bodies = reportBodies(page)
    await reachEventReportPreview(page, context, baseURL)
    await page.getByRole('button', { name: 'Submit to this event' }).click()
    await expect(page.getByText('This photo already belongs to an earlier report. View the original in My Records. Your scan is kept. You can submit it as an ordinary report.')).toBeVisible()
    await page.getByRole('button', { name: 'Submit as ordinary report' }).click()
    await expect(page.getByRole('heading', { name: 'Report published' })).toBeVisible()

    expect(bodies).toHaveLength(2)
    const [tagged, ordinary] = bodies
    // The event tag does not drop any of the evidence screening relies on.
    expect(tagged.imageSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(tagged.imageSha256).toBe(ordinary.imageSha256)
    for (const key of ['captureId', 'photoKey', 'speciesId', 'outcome', 'confidence', 'modelVersion', 'observedAt', 'location', 'locationAccuracyM', 'extent', 'consent']) {
      expect(tagged[key], key).toEqual(ordinary[key])
      expect(tagged[key], key).not.toBeUndefined()
    }
    expect(tagged.consent).toEqual({ accurate: true, noPII: true })
    expect(Object.keys(tagged).filter((key) => !(key in ordinary)).sort()).toEqual(['capturedAt', 'eventId'])
  })

  test('AC 9.4.4 Community-reported labelling preserved', async ({ page, context, baseURL }) => {
    // The mock keeps the event id inside the stored submission; the real API
    // returns it on the report itself, so the reply is reshaped to match.
    await rewriteMockReply(page, { pattern: '^/api/v1/reports/(mine|[0-9a-f-]{36})$', liftEventId: true })
    await reachEventReportPreview(page, context, baseURL)
    await expect(page.getByText('Community-reported event evidence. Joining an event does not grant removal permission.')).toBeVisible()
    await page.getByRole('button', { name: 'Submit to this event' }).click()
    await expect(page.getByRole('heading', { name: 'Report published' })).toBeVisible()
    await expect(page.getByText('Community report - not expert validated')).toBeVisible()
    await page.getByRole('button', { name: 'View on map' }).click()
    // Shared map: the event-linked sighting carries the community-report label.
    const sighting = page.getByRole('dialog', { name: 'Sighting details' })
    await expect(sighting).toContainText('Community report - not expert validated')
    await expect(sighting).not.toContainText(/expert[- ]verified|verified by (an )?expert|officially verified/i)
    await sighting.getByRole('button', { name: 'Close sighting details' }).click()

    // My Records: the event link is shown as community-reported evidence.
    await page.getByRole('link', { name: /records/i }).first().click()
    await expect(page).toHaveURL(/\/reports$/)
    const item = page.locator('.my-reports__item').first()
    await expect(item).toContainText('Community-reported event evidence')
    await item.locator('.my-reports__link').click()
    // Report detail: still a community report, with screening called what it is.
    const detail = page.locator('.report-tracking')
    await expect(detail).toContainText('Community-reported event evidence. Automated screening is not expert validation.')
    await expect(detail).toContainText('Community report - not expert validated')
    // The event association never upgrades the trust wording.
    await expect(detail).not.toContainText(/expert[- ]verified|verified by (an )?expert|officially verified/i)
  })

  test('AC 9.4.6 Event-scoped rate limit', async ({ page, context, baseURL }) => {
    // Mock level: what the participant sees once the per-event budget is
    // spent. Counting event-linked reports per identity (default 60), and
    // using that budget instead of the ordinary throttle, is the real API's.
    await page.addInitScript(() => { window.__msw = { reportRejection: { status: 429, code: 'event_budget_exceeded', detail: 'Event report budget reached.' } } })
    const bodies = reportBodies(page)
    await reachEventReportPreview(page, context, baseURL)
    await page.getByRole('button', { name: 'Submit to this event' }).click()
    // The limit is explained as this event's limit, and the observation is not lost.
    await expect(page.getByText('You have reached this event’s report limit. Your scan is kept. You can submit it as an ordinary report.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Submit to this event' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Submit as ordinary report' }).click()
    await expect(page.getByRole('heading', { name: 'Report published' })).toBeVisible()
    expect(bodies.map((body) => body.eventId ?? null)).toEqual(['event-1', null])
  })
})
