import { afterEach, describe, expect, it, vi } from 'vitest'
import { eventsApi } from './events'

const eventWire = {
  event_id: 'event-42', title: 'Trail survey', purpose: 'Record observations',
  event_type: 'survey', status: 'published', place_id: 'place-8', place_name: 'Bukit Kiara',
  target_species_ids: ['mikania-micrantha'], meeting_latitude: 3.15, meeting_longitude: 101.64,
  start_at: '2030-02-01T08:00:00Z', end_at: '2030-02-01T10:00:00Z', permission_context: 'unknown',
  is_joined: true, participation_id: 'participation-4', joined_count: 3,
}

afterEach(() => vi.unstubAllGlobals())

describe('events API boundary', () => {
  it('normalizes raw snake_case discovery and detail responses', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [eventWire] }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const list = await eventsApi.list({ speciesId: ['mikania-micrantha', 'lantana-camara'] })
    expect(list.items[0]).toMatchObject({ id: 'event-42', eventType: 'survey', placeId: 'place-8', placeName: 'Bukit Kiara', participationId: 'participation-4' })
    expect(fetch.mock.calls[0][0]).toContain('species_id=mikania-micrantha')
    expect(fetch.mock.calls[0][0]).toContain('species_id=lantana-camara')
  })

  it('strips UI-only draft fields and normalizes event_id after create', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ event_id: 'created-9', status: 'draft' }), { status: 201 }))
    vi.stubGlobal('fetch', fetch)
    const created = await eventsApi.create({ ...eventWire, id: 'ignore-me', eventType: 'survey', placeId: 'place-8', targetSpeciesIds: [], meetingLatitude: 3.15, meetingLongitude: 101.64, startAt: '2030-02-01T08:00:00Z', endAt: '2030-02-01T10:00:00Z', permissionContext: 'unknown', status: 'published' })
    expect(created).toEqual({ eventId: 'created-9', status: 'draft' })
    const body = JSON.parse(fetch.mock.calls[0][1].body as string)
    expect(body).not.toHaveProperty('id')
    expect(body).not.toHaveProperty('status')
  })

  it('normalizes raw participation and completed-summary fields', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ participation_id: 'p-1' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ reports_submitted_count: 4, distinct_species_count: 2, place_id: 'place-8', place_name: 'Bukit Kiara', start_at: '2030-02-01T08:00:00Z', end_at: '2030-02-01T10:00:00Z', next_event: { event_id: 'event-next', start_at: '2030-02-08T08:00:00Z' } }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    await expect(eventsApi.join('event-42')).resolves.toEqual({ participationId: 'p-1' })
    await expect(eventsApi.summary('event-42')).resolves.toMatchObject({ reportsSubmittedCount: 4, distinctSpeciesCount: 2, placeName: 'Bukit Kiara', nextEvent: { eventId: 'event-next' } })
  })
})
