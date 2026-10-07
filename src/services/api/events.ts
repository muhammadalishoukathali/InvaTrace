import { api } from '@/services/api-client'

export type EventType = 'survey' | 'removal' | 'monitoring' | 'other'
export type EventStatus = 'draft' | 'published' | 'cancelled' | 'completed'

export interface CommunityEvent {
  id: string
  title: string
  purpose: string
  eventType: EventType
  status: EventStatus
  placeId: string
  placeName?: string
  placeType?: 'park' | 'forest' | 'wood' | 'trail'
  targetSpeciesIds: string[]
  targetSpecies?: Array<{ id: string; name: string; scientificName?: string }>
  meetingLatitude: number
  meetingLongitude: number
  meetingNote?: string | null
  startAt: string
  endAt: string
  safetyNotes?: string | null
  permissionContext: 'unknown' | 'explicit_permission'
  hostDisplayName?: string
  joinedCount?: number
  isJoined?: boolean
  participationId?: string | null
  isHost?: boolean
  activityLocked?: boolean
  lastCheckinAt?: string | null
  chatLink?: string | null
  hidden?: boolean
  canRestore?: boolean
}

export interface EventSummary {
  reportsSubmittedCount: number
  distinctSpeciesCount: number
  placeId: string
  placeName: string
  startAt: string
  endAt: string
  nextEvent: { eventId: string; startAt: string } | null
}

type WireEvent = Partial<CommunityEvent> & { can_restore?: boolean; event_id?: string; event_type?: EventType; place_id?: string; place_name?: string; place_type?: CommunityEvent['placeType']; target_species_ids?: string[]; target_species?: CommunityEvent['targetSpecies']; meeting_latitude?: number; meeting_longitude?: number; meeting_note?: string | null; start_at?: string; end_at?: string; safety_notes?: string | null; permission_context?: CommunityEvent['permissionContext']; host_display_name?: string; joined_count?: number; is_joined?: boolean; participation_id?: string | null; is_host?: boolean; activity_locked?: boolean; last_checkin_at?: string | null; chat_link?: string | null }
const eventFromWire = (wire: WireEvent): CommunityEvent => ({
  ...(wire as CommunityEvent), canRestore: wire.canRestore ?? wire.can_restore, id: wire.id ?? wire.event_id ?? '', eventType: wire.eventType ?? wire.event_type ?? 'other', placeId: wire.placeId ?? wire.place_id ?? '', placeName: wire.placeName ?? wire.place_name, placeType: wire.placeType ?? wire.place_type, targetSpeciesIds: wire.targetSpeciesIds ?? wire.target_species_ids ?? [], targetSpecies: wire.targetSpecies ?? wire.target_species, meetingLatitude: wire.meetingLatitude ?? wire.meeting_latitude ?? 0, meetingLongitude: wire.meetingLongitude ?? wire.meeting_longitude ?? 0, meetingNote: wire.meetingNote ?? wire.meeting_note, startAt: wire.startAt ?? wire.start_at ?? '', endAt: wire.endAt ?? wire.end_at ?? '', safetyNotes: wire.safetyNotes ?? wire.safety_notes, permissionContext: wire.permissionContext ?? wire.permission_context ?? 'unknown', hostDisplayName: wire.hostDisplayName ?? wire.host_display_name, joinedCount: wire.joinedCount ?? wire.joined_count, isJoined: wire.isJoined ?? wire.is_joined, participationId: wire.participationId ?? wire.participation_id, isHost: wire.isHost ?? wire.is_host, activityLocked: wire.activityLocked ?? wire.activity_locked, lastCheckinAt: wire.lastCheckinAt ?? wire.last_checkin_at, chatLink: wire.chatLink ?? wire.chat_link,
})

export interface EventDraft {
  id?: string
  title: string
  purpose: string
  eventType: EventType
  placeId: string
  meetingLatitude: number
  meetingLongitude: number
  meetingNote?: string
  startAt: string
  endAt: string
  targetSpeciesIds: string[]
  safetyNotes?: string
  permissionContext: 'unknown' | 'explicit_permission'
  chatLink?: string
  capacity?: number | null
  status?: 'draft' | 'published'
}

const query = (values: Record<string, string | string[] | undefined>) => {
  const params = new URLSearchParams()
  Object.entries(values).forEach(([key, value]) => {
    if (Array.isArray(value)) value.forEach((item) => params.append(key, item))
    else if (value) params.set(key, value)
  })
  const text = params.toString()
  return text ? `?${text}` : ''
}

export const eventsApi = {
  list(filters: { placeId?: string; bbox?: string; from?: string; to?: string; speciesId?: string[] } = {}) {
    const { placeId, speciesId, ...range } = filters
    return api<{ items: WireEvent[] }>(`${placeId ? `/api/v1/places/${placeId}/events` : '/api/v1/events'}${query({ ...range, species_id: speciesId })}`).then((data) => ({ items: data.items.map(eventFromWire) }))
  },
  get(id: string) { return api<WireEvent>(`/api/v1/events/${id}`).then(eventFromWire) },
  mine() { return api<{ items: WireEvent[] }>('/api/v1/events/mine').then((data) => ({ items: data.items.map(eventFromWire) })) },
  place(placeId: string) { return api<{ items: WireEvent[] }>(`/api/v1/places/${placeId}/events`).then((data) => ({ items: data.items.map(eventFromWire) })) },
  create(draft: EventDraft) {
    const body = {
      title: draft.title, purpose: draft.purpose, eventType: draft.eventType,
      placeId: draft.placeId, meetingLatitude: draft.meetingLatitude,
      meetingLongitude: draft.meetingLongitude, meetingNote: draft.meetingNote,
      startAt: draft.startAt, endAt: draft.endAt, targetSpeciesIds: draft.targetSpeciesIds,
      safetyNotes: draft.safetyNotes, permissionContext: draft.permissionContext,
      chatLink: draft.chatLink, capacity: draft.capacity,
    }
    return api<{ eventId?: string; event_id?: string; status: EventStatus }>('/api/v1/events', { method: 'POST', body: JSON.stringify(body) })
      .then((value) => ({ eventId: value.eventId ?? value.event_id ?? '', status: value.status }))
  },
  update(id: string, draft: Partial<EventDraft>) { return api<WireEvent>(`/api/v1/events/${id}`, { method: 'PATCH', body: JSON.stringify(draft) }).then(eventFromWire) },
  cancel(id: string) { return api<void>(`/api/v1/events/${id}`, { method: 'DELETE' }) },
  restore(id: string) { return api<WireEvent>(`/api/v1/events/${id}`, { method: 'PATCH', body: JSON.stringify({ restore: true }) }).then(eventFromWire) },
  join(id: string) { return api<{ participationId?: string; participation_id?: string }>(`/api/v1/events/${id}/participants`, { method: 'POST' }).then((value) => ({ participationId: value.participationId ?? value.participation_id ?? '' })) },
  withdraw(id: string, participationId: string) { return api<void>(`/api/v1/events/${id}/participants/${participationId}`, { method: 'DELETE' }) },
  checkIn(id: string, location: { latitude: number; longitude: number; accuracyM: number; capturedAt: string }) {
    return api<{ checkedInAt?: string; checked_in_at?: string }>(`/api/v1/events/${id}/check-in`, { method: 'POST', body: JSON.stringify(location) }).then((value) => ({ checkedInAt: value.checkedInAt ?? value.checked_in_at ?? new Date().toISOString() }))
  },
  flag(id: string, reason: string) { return api<{ flagged: boolean; hidden: boolean }>(`/api/v1/events/${id}/flag`, { method: 'POST', body: JSON.stringify({ reason }) }) },
  summary(id: string) { return api<EventSummary & { reports_submitted_count?: number; distinct_species_count?: number; place_id?: string; place_name?: string; start_at?: string; end_at?: string; next_event?: { event_id: string; start_at: string } | null }>(`/api/v1/events/${id}/summary`).then((value) => ({ reportsSubmittedCount: value.reportsSubmittedCount ?? value.reports_submitted_count ?? 0, distinctSpeciesCount: value.distinctSpeciesCount ?? value.distinct_species_count ?? 0, placeId: value.placeId ?? value.place_id ?? '', placeName: value.placeName ?? value.place_name ?? '', startAt: value.startAt ?? value.start_at ?? '', endAt: value.endAt ?? value.end_at ?? '', nextEvent: value.nextEvent ?? (value.next_event ? { eventId: value.next_event.event_id, startAt: value.next_event.start_at } : null) })) },
}
