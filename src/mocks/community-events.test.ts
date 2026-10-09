// The dev MSW events mock must answer like backend/app/api/routers/events.py,
// so UI states exercised against the mock match production behaviour.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'
import { handlers } from './handlers'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, String(value)) }
}

const server = setupServer(...handlers)
const BASE = 'http://localhost'
const KIARA = '10000000-0000-4000-8000-000000000001'
const KOTA_PROTECTED = '10000000-0000-4000-8000-000000000003'
const RIMBA_UNCERTAIN = '10000000-0000-4000-8000-000000000004'
const HOST_UNLOCK_KEY = 'invatrace.mock.host-unlocked'

beforeAll(() => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: new MemoryStorage() })
  server.listen({ onUnhandledRequest: 'error' })
  // Most cases test other rules; the hosting gate has its own case below.
  localStorage.setItem(HOST_UNLOCK_KEY, 'on')
})
afterAll(() => server.close())

async function identity(character: string) {
  const response = await fetch(`${BASE}/api/v1/profiles/start`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ installationToken: character.repeat(43) }),
  })
  const { accessToken } = await response.json() as { accessToken: string }
  return (path: string, init: RequestInit = {}) => fetch(`${BASE}${path}`, {
    ...init, headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
  })
}

const hours = (value: number) => new Date(Date.now() + value * 3_600_000).toISOString()
const draft = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  title: 'Lake survey', purpose: 'Record what we find', eventType: 'survey', placeId: KIARA,
  meetingLatitude: 3.15, meetingLongitude: 101.64, startAt: hours(24), endAt: hours(26),
  targetSpeciesIds: [], safetyNotes: 'Stay on paths.', ...overrides,
})

describe('events mock parity with the backend', () => {
  it('rejects an unknown place with 422', async () => {
    const host = await identity('P')
    const unknown = await host('/api/v1/events', { method: 'POST', body: draft({ placeId: 'nope' }) })
    expect(unknown.status).toBe(422)
    expect((await unknown.json()).code).toBe('invalid_place')
  })

  it('locks hosting until three sightings are reported (AC 9.6.1)', async () => {
    localStorage.removeItem(HOST_UNLOCK_KEY)
    try {
      const host = await identity('L')
      expect(await (await host('/api/v1/events/host-eligibility')).json()).toEqual({ eligible: false, report_count: 0, required: 3 })
      const locked = await host('/api/v1/events', { method: 'POST', body: draft() })
      expect(locked.status).toBe(403)
      expect((await locked.json()).code).toBe('hosting_locked')
    } finally {
      localStorage.setItem(HOST_UNLOCK_KEY, 'on')
    }
  })

  it('derives land status and only allows removal outside mapped protected land (AC 9.6.6 / 9.6.7)', async () => {
    const host = await identity('R')
    const protectedStatus = await (await host(`/api/v1/places/${KOTA_PROTECTED}/land-status`)).json()
    expect(protectedStatus).toMatchObject({ land_status: 'protected', protected_area_name: 'Kota Damansara Forest Reserve' })
    expect(protectedStatus.allowed_event_types).not.toContain('removal')
    expect((await (await host(`/api/v1/places/${RIMBA_UNCERTAIN}/land-status`)).json()).allowed_event_types).not.toContain('removal')
    expect((await (await host(`/api/v1/places/${KIARA}/land-status`)).json()).allowed_event_types).toContain('removal')

    const refused = await host('/api/v1/events', { method: 'POST', body: draft({ placeId: KOTA_PROTECTED, eventType: 'removal', meetingLatitude: 3.17, meetingLongitude: 101.59 }) })
    expect(refused.status).toBe(422)
    expect((await refused.json()).code).toBe('removal_not_allowed_here')
    const allowed = await host('/api/v1/events', { method: 'POST', body: draft({ eventType: 'removal' }) })
    expect(allowed.status).toBe(201)
    const { event_id: id } = await allowed.json() as { event_id: string }
    const detail = await (await host(`/api/v1/events/${id}`)).json()
    expect(detail.land_status).toBe('not_protected')
    const moved = await host(`/api/v1/events/${id}`, { method: 'PATCH', body: JSON.stringify({ placeId: KOTA_PROTECTED, meetingLatitude: 3.17, meetingLongitude: 101.59 }) })
    expect((await moved.json()).code).toBe('removal_not_allowed_here')
  })

  it('caps live hosted events at three with 429', async () => {
    const host = await identity('C')
    for (let index = 0; index < 3; index += 1) {
      expect((await host('/api/v1/events', { method: 'POST', body: draft() })).status).toBe(201)
    }
    const fourth = await host('/api/v1/events', { method: 'POST', body: draft() })
    expect(fourth.status).toBe(429)
    expect((await fourth.json()).code).toBe('event_host_cap_exceeded')
  })

  it('keeps one participation per identity, guards flags, restore and summary like the API', async () => {
    const host = await identity('H')
    const guest = await identity('G')
    const { event_id: id } = await (await host('/api/v1/events', { method: 'POST', body: draft() })).json() as { event_id: string }
    expect((await guest(`/api/v1/events/${id}`)).status).toBe(404)
    expect((await guest(`/api/v1/events/${id}/flag`, { method: 'POST', body: JSON.stringify({ reason: 'spam' }) })).status).toBe(404)
    expect((await host(`/api/v1/events/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'published' }) })).status).toBe(200)

    const first = await (await guest(`/api/v1/events/${id}/participants`, { method: 'POST' })).json() as { participation_id: string; event_id: string; joined_at: string }
    expect(first.event_id).toBe(id)
    expect(first.joined_at).toBeTruthy()
    expect((await guest(`/api/v1/events/${id}/participants/${first.participation_id}`, { method: 'DELETE' })).status).toBe(204)
    const again = await (await guest(`/api/v1/events/${id}/participants`, { method: 'POST' })).json() as { participation_id: string }
    expect(again.participation_id).toBe(first.participation_id)
    expect((await host(`/api/v1/events/${id}/participants/${first.participation_id}`, { method: 'DELETE' })).status).toBe(403)

    expect((await host(`/api/v1/events/${id}/flag`, { method: 'POST', body: JSON.stringify({ reason: 'mine' }) })).status).toBe(403)
    const restore = await host(`/api/v1/events/${id}`, { method: 'PATCH', body: JSON.stringify({ restore: true }) })
    expect(restore.status).toBe(409)
    expect((await restore.json()).code).toBe('event_not_hidden')
    const summary = await guest(`/api/v1/events/${id}/summary`)
    expect(summary.status).toBe(409)
    expect((await summary.json()).code).toBe('event_not_completed')

    expect((await host(`/api/v1/events/${id}`, { method: 'DELETE' })).status).toBe(204)
    const edit = await host(`/api/v1/events/${id}`, { method: 'PATCH', body: JSON.stringify({ title: 'Renamed' }) })
    expect(edit.status).toBe(409)
    expect((await guest(`/api/v1/events/${id}/participants`, { method: 'POST' })).status).toBe(409)
  })

  it('rejects invalid discovery bounding boxes with 400', async () => {
    const guest = await identity('B')
    expect((await guest('/api/v1/events?bbox=0,0,1,1')).status).toBe(400)
    expect((await guest('/api/v1/events?bbox=101,3,102,4')).status).toBe(200)
  })
})
