// MSW stand-ins for the Epic 9 events API and the Epic 7 guided-missions API,
// so both features work in development and demos without a PostGIS backend.
// They mirror the real routers' status codes, error codes and ownership rules
// (backend/app/api/routers/events.py and guided_missions.py) closely enough to
// exercise every UI state, but they are not a second implementation of the
// server's spatial checks.
import { http, HttpResponse, passthrough } from 'msw'
import type { PseudonymousProfile } from '@/types'

const url = (path: string) => `*${path}`

interface MockPlace {
  placeId: string
  name: string
  type: 'park' | 'forest' | 'wood' | 'trail'
  geometryVersion: string
  /** Mock stand-in for the server's protected-area lookup (AC 9.6.7). */
  landStatus?: 'protected' | 'not_protected' | 'uncertain'
  protectedAreaName?: string
  operator?: string
}
interface Deps {
  profileFor: (request: Request) => PseudonymousProfile | null
  places: () => MockPlace[]
  placeContains: (placeId: string, point: { lat: number; lng: number }) => boolean
  reportsForMission: (missionId: string) => Array<{ reportId: string; speciesId: string | null; status: string; submittedAt: string }>
  scansForMission: (missionId: string) => number
  /** Reports by this identity that are not rejected or sent back for a rescan. */
  reportCountFor: (profileId: string) => number
}

type EventStatus = 'draft' | 'published' | 'cancelled' | 'completed'
interface MockEvent {
  id: string
  hostProfileId: string
  hostDisplayName: string | null
  status: EventStatus
  hidden: boolean
  flags: Set<string>
  eventType: 'survey' | 'removal' | 'monitoring' | 'other'
  title: string
  purpose: string
  placeId: string
  targetSpeciesIds: string[]
  meetingLatitude: number
  meetingLongitude: number
  meetingNote: string | null
  startAt: string
  endAt: string
  safetyNotes: string | null
  landStatus: 'protected' | 'not_protected' | 'uncertain'
  protectedAreaName: string | null
  chatLink: string | null
  capacity: number | null
  participants: Map<string, { id: string; status: 'joined' | 'withdrawn'; joinedAt: string }>
  checkins: Map<string, string>
}

interface MockMission {
  missionId: string
  profileId: string
  placeId: string
  status: 'active' | 'completed'
  datasetVersion: string
  selectedSpeciesId: string | null
  startedAt: string
  updatedAt: string
  completedAt: string | null
  plants: Array<{ speciesId: string; state: 'not_checked' | 'looked_for' | 'unable_to_check'; noTargetFound: boolean; updatedAt: string }>
}

const problem = (status: number, code: string, detail: string) => HttpResponse.json({ code, detail }, { status })
const CHECKIN_GRACE_MS = 30 * 60 * 1000
const MAX_LIVE_EVENTS = 3
const HOST_MIN_REPORTS = 3
const OBSERVE_ONLY = ['survey', 'monitoring', 'other']
// Dev/demo escape hatch: set this localStorage key to "on" to host without
// first submitting three mock reports.
const HOST_UNLOCK_KEY = 'invatrace.mock.host-unlocked'
const HIDE_THRESHOLD = 3

export function createCommunityHandlers(deps: Deps) {
  const events = new Map<string, MockEvent>()
  // Missions survive a reload, like the mock adoptions, so "Resume mission"
  // can be demonstrated without the real backend.
  const MISSIONS_KEY = 'invatrace-mock-missions-v1'
  const missions = new Map<string, MockMission>((() => {
    try { return (JSON.parse(localStorage.getItem(MISSIONS_KEY) ?? '[]') as MockMission[]).map((item) => [item.missionId, item] as const) } catch { return [] }
  })())
  const saveMissions = () => { try { localStorage.setItem(MISSIONS_KEY, JSON.stringify([...missions.values()])) } catch { /* storage unavailable */ } }
  let seeded = false

  // Two published sample events so discovery has something to show in dev.
  // Hosted by a placeholder identity that no browser profile can match.
  const seed = () => {
    if (seeded) return
    seeded = true
    const [kiara, , kota, , titiwangsa] = deps.places()
    const day = (offsetDays: number, hour: number) => {
      const date = new Date()
      date.setDate(date.getDate() + offsetDays)
      date.setHours(hour, 0, 0, 0)
      return date.toISOString()
    }
    const base = {
      hostProfileId: 'seed-host', status: 'published' as const, hidden: false, flags: new Set<string>(),
      meetingNote: null, safetyNotes: 'Observe and report only. Wear closed shoes, bring water and stay on marked paths.',
      chatLink: null, capacity: null,
    }
    const samples: Array<Omit<MockEvent, 'landStatus' | 'protectedAreaName'>> = [
      { ...base, id: 'evt-seed-survey', hostDisplayName: 'Aina', eventType: 'survey', title: 'Saturday Mikania survey', purpose: 'Walk the lower loop together and record every Mikania and Siam weed patch we can find.', placeId: titiwangsa?.placeId ?? kiara.placeId, targetSpeciesIds: ['mikania-micrantha', 'chromolaena-odorata'], meetingLatitude: 3.1778, meetingLongitude: 101.7069, meetingNote: 'Main gate by the lake, next to the noticeboard', startAt: day(3, 8), endAt: day(3, 11), participants: new Map(), checkins: new Map() },
      { ...base, id: 'evt-seed-monitoring', hostDisplayName: null, eventType: 'monitoring', title: 'Monthly regrowth check', purpose: 'Revisit last month’s removal sites and record whether anything has grown back.', placeId: kota.placeId, targetSpeciesIds: ['mikania-micrantha'], meetingLatitude: 3.17, meetingLongitude: 101.59, startAt: day(10, 9), endAt: day(10, 12), participants: new Map(), checkins: new Map() },
    ]
    samples.forEach((event) => events.set(event.id, { ...event, ...landOf(event.placeId) }))
  }

  const placeOf = (placeId: string) => deps.places().find((place) => place.placeId === placeId)
  const landOf = (placeId: string) => {
    const place = placeOf(placeId)
    return { landStatus: place?.landStatus ?? 'uncertain', protectedAreaName: place?.protectedAreaName ?? null } as const
  }
  const allowedTypes = (placeId: string) => landOf(placeId).landStatus === 'not_protected' ? [...OBSERVE_ONLY, 'removal'] : OBSERVE_ONLY
  const hostingUnlocked = () => { try { return localStorage.getItem(HOST_UNLOCK_KEY) === 'on' } catch { return false } }
  const eligibilityFor = (profileId: string) => {
    const count = deps.reportCountFor(profileId)
    return { eligible: hostingUnlocked() || count >= HOST_MIN_REPORTS, report_count: count, required: HOST_MIN_REPORTS }
  }
  const joinedCount = (event: MockEvent) => [...event.participants.values()].filter((item) => item.status === 'joined').length
  const isLive = (event: MockEvent) => event.status === 'published' && !event.hidden && Date.parse(event.endAt) > Date.now()
  // Same rule as backend _host_cap: draft or published events that have not ended.
  const countsTowardCap = (event: MockEvent) => (event.status === 'draft' || event.status === 'published') && Date.parse(event.endAt) > Date.now()
  const capProblem = () => problem(429, 'event_host_cap_exceeded', `You already have ${MAX_LIVE_EVENTS} upcoming hosted events. Cancel one or wait for one to finish before adding another. Your existing events are unchanged.`)
  const completeExpired = () => events.forEach((event) => { if (event.status === 'published' && Date.parse(event.endAt) <= Date.now()) event.status = 'completed' })

  const serialize = (event: MockEvent, viewer: string | null, detail: boolean) => {
    const place = placeOf(event.placeId)
    const participation = viewer ? event.participants.get(viewer) : undefined
    const joined = participation?.status === 'joined'
    const isHost = viewer === event.hostProfileId
    return {
      event_id: event.id, status: event.status, event_type: event.eventType, title: event.title, purpose: event.purpose,
      target_species_ids: event.targetSpeciesIds, place_id: event.placeId, place_name: place?.name ?? 'Mapped place',
      place_type: place?.type, meeting_latitude: event.meetingLatitude, meeting_longitude: event.meetingLongitude,
      meeting_note: event.meetingNote, start_at: event.startAt, end_at: event.endAt, safety_notes: event.safetyNotes,
      permission_context: 'unknown', land_status: event.landStatus, protected_area_name: event.protectedAreaName, capacity: event.capacity, joined_count: joinedCount(event),
      last_checkin_at: viewer ? event.checkins.get(viewer) ?? null : null,
      host_display_name: event.hostDisplayName ?? 'Community host',
      ...(detail ? {
        is_joined: joined, participation_id: joined ? participation!.id : null, is_host: isHost,
        can_restore: isHost && event.hidden && event.status !== 'cancelled', hidden: isHost ? event.hidden : false,
        activity_locked: event.checkins.size > 0,
        chat_link: (isHost || joined) && event.status !== 'cancelled' && !event.hidden ? event.chatLink : null,
      } : {}),
    }
  }

  const draftProblem = (errors: string[]) => errors.includes('placeId')
    ? problem(422, 'invalid_place', 'Choose a supported mapped place for the event.')
    : errors.includes('meetingLatitude')
      ? problem(422, 'meeting_point_outside_place', 'Meeting point is outside the event place.')
      : problem(422, 'invalid_event_time', 'End time must be after start time.')
  // Mirrors backend _apply_land_status: removal only outside mapped protected land.
  const landProblem = (body: Record<string, unknown>) => {
    const placeId = String(body.placeId ?? '')
    if (!placeOf(placeId) || allowedTypes(placeId).includes(String(body.eventType))) return null
    return problem(422, 'removal_not_allowed_here', 'Only survey, monitoring or other observe-and-report activities can be hosted at this place.')
  }
  const validChatLink = (value: unknown) => {
    if (value === undefined || value === null || String(value).trim() === '') return true
    try { const link = new URL(String(value)); return link.protocol === 'https:' && Boolean(link.hostname) && !link.username } catch { return false }
  }
  const validateDraft = (body: Record<string, unknown>, partial: boolean) => {
    const errors: string[] = []
    const has = (key: string) => body[key] !== undefined
    if ((!partial || has('placeId')) && !placeOf(String(body.placeId ?? ''))) errors.push('placeId')
    if ((!partial || has('startAt') || has('endAt')) && body.startAt && body.endAt && Date.parse(String(body.endAt)) <= Date.parse(String(body.startAt))) errors.push('endAt')
    if ((!partial || has('meetingLatitude')) && body.placeId && typeof body.meetingLatitude === 'number' && typeof body.meetingLongitude === 'number'
      && !deps.placeContains(String(body.placeId), { lat: body.meetingLatitude, lng: body.meetingLongitude })) errors.push('meetingLatitude')
    return errors
  }

  const missionJson = (mission: MockMission) => ({
    ...mission,
    scansCount: deps.scansForMission(mission.missionId),
    reports: deps.reportsForMission(mission.missionId),
  })
  const missionSummary = (mission: MockMission) => {
    const reports = deps.reportsForMission(mission.missionId)
    return {
      missionId: mission.missionId, placeId: mission.placeId, status: mission.status,
      startedAt: mission.startedAt, completedAt: mission.completedAt,
      lookedForCount: mission.plants.filter((plant) => plant.state === 'looked_for').length,
      unableToCheckCount: mission.plants.filter((plant) => plant.state === 'unable_to_check').length,
      notCheckedCount: mission.plants.filter((plant) => plant.state === 'not_checked').length,
      // As on the server, a plant with a submitted sighting is never also a no-find outcome.
      noTargetFoundCount: mission.plants.filter((plant) => plant.state === 'looked_for' && plant.noTargetFound
        && !reports.some((report) => report.speciesId === plant.speciesId)).length,
      scansCount: deps.scansForMission(mission.missionId),
      reportsSubmittedCount: reports.length,
      reports,
    }
  }
  const ownMission = (request: Request, missionId: string) => {
    const profile = deps.profileFor(request)
    if (!profile) return { error: problem(401, 'session_required', 'Sign in again.') }
    const mission = missions.get(missionId)
    if (!mission) return { error: problem(404, 'mission_not_found', 'Mission not found.') }
    if (mission.profileId !== profile.id) return { error: problem(403, 'not_mission_owner', 'This mission belongs to another identity.') }
    return { mission }
  }

  // Browser specs that stub these endpoints with page.route() set this flag,
  // because a response from the MSW service worker never reaches page.route.
  const routedByTest = () => {
    try { return localStorage.getItem('invatrace.mock.community') === 'off' } catch { return false }
  }
  const optOut = () => (routedByTest() ? passthrough() : undefined)

  return [
    http.all(url('/api/v1/events'), optOut),
    http.all(url('/api/v1/events/*'), optOut),
    http.all(url('/api/v1/places/:placeId/events'), optOut),
    http.all(url('/api/v1/places/:placeId/land-status'), optOut),
    http.all(url('/api/v1/guided-missions'), optOut),
    http.all(url('/api/v1/guided-missions/*'), optOut),

    // ---- Epic 9 events ---------------------------------------------------
    http.get(url('/api/v1/events/host-eligibility'), ({ request }) => {
      const profile = deps.profileFor(request)
      if (!profile) return problem(401, 'session_required', 'Sign in again.')
      return HttpResponse.json(eligibilityFor(profile.id))
    }),
    http.get(url('/api/v1/places/:placeId/land-status'), ({ params }) => {
      const place = placeOf(String(params.placeId))
      if (!place) return problem(404, 'place_not_found', 'Not found')
      const land = landOf(place.placeId)
      const reason = land.landStatus === 'protected'
        ? `This place overlaps ${land.protectedAreaName ?? 'a mapped protected area'}. Only survey, monitoring or other observe-and-report activities can be hosted here.`
        : land.landStatus === 'uncertain'
          ? 'Protected-area status could not be confirmed for this place, so only survey, monitoring or other observe-and-report activities can be hosted here.'
          : 'This place is not in a mapped protected area. All activity types are available.'
      return HttpResponse.json({
        place_id: place.placeId, land_status: land.landStatus, protected_area_name: land.protectedAreaName,
        operator: place.operator ?? null, dataset_version: 'mock', allowed_event_types: allowedTypes(place.placeId), reason,
        disclaimer: 'Mapped status is not removal permission. Being outside a mapped protected area does not establish ownership, access rights, or permission; every participant still goes through the safety checks before any active step.',
      })
    }),
    http.get(url('/api/v1/events/mine'), ({ request }) => {
      seed(); completeExpired()
      const profile = deps.profileFor(request)
      if (!profile) return problem(401, 'session_required', 'Sign in again.')
      const items = [...events.values()].filter((event) => event.hostProfileId === profile.id)
        .sort((a, b) => Date.parse(b.startAt) - Date.parse(a.startAt))
        .map((event) => serialize(event, profile.id, true))
      return HttpResponse.json({ items })
    }),
    http.get(url('/api/v1/events'), ({ request }) => {
      seed(); completeExpired()
      const params = new URL(request.url).searchParams
      const bbox = params.get('bbox')
      const [west, south, east, north] = bbox ? bbox.split(',').map(Number) : [-180, -90, 180, 90]
      if (bbox && (bbox.split(',').length !== 4 || [west, south, east, north].some((value) => !Number.isFinite(value))
        || !(west >= 99.3 && west <= east && east <= 119.5 && south >= 0.8 && south <= north && north <= 7.5))) return problem(400, 'invalid_bbox', 'The bounding box is invalid.')
      const from = params.get('from') ? Date.parse(params.get('from')!) : null
      const to = params.get('to') ? Date.parse(params.get('to')!) : null
      if ((from !== null && Number.isNaN(from)) || (to !== null && Number.isNaN(to)) || (from !== null && to !== null && to < from)) return problem(422, 'invalid_event_time', 'Use timezone-aware dates with Until after From.')
      const species = params.getAll('species_id')
      const items = [...events.values()].filter((event) => isLive(event)
        && event.meetingLongitude >= west && event.meetingLongitude <= east && event.meetingLatitude >= south && event.meetingLatitude <= north
        && (from === null || Date.parse(event.endAt) >= from) && (to === null || Date.parse(event.startAt) <= to)
        && (!species.length || event.targetSpeciesIds.some((id) => species.includes(id))))
        .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))
        .map((event) => serialize(event, null, false))
      return HttpResponse.json({ items })
    }),
    http.get(url('/api/v1/places/:placeId/events'), ({ params }) => {
      seed(); completeExpired()
      if (!placeOf(String(params.placeId))) return problem(404, 'place_not_found', 'Not found')
      const items = [...events.values()].filter((event) => isLive(event) && event.placeId === params.placeId)
        .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))
        .map((event) => serialize(event, null, false))
      return HttpResponse.json({ items })
    }),
    http.post(url('/api/v1/events'), async ({ request }) => {
      seed()
      const profile = deps.profileFor(request)
      if (!profile) return problem(401, 'session_required', 'Sign in again.')
      const body = await request.json() as Record<string, unknown>
      if (!validChatLink(body.chatLink)) return problem(422, 'validation_error', 'chat_link must use https')
      const eligibility = eligibilityFor(profile.id)
      if (!eligibility.eligible) return problem(403, 'hosting_locked', `Report at least ${HOST_MIN_REPORTS} sightings before hosting an event (${eligibility.report_count} of ${HOST_MIN_REPORTS} so far).`)
      if ([...events.values()].filter((item) => item.hostProfileId === profile.id && countsTowardCap(item)).length >= MAX_LIVE_EVENTS) return capProblem()
      const errors = validateDraft(body, false)
      if (errors.length) return draftProblem(errors)
      const land = landProblem(body)
      if (land) return land
      const id = `evt-${crypto.randomUUID().slice(0, 8)}`
      events.set(id, {
        id, hostProfileId: profile.id, hostDisplayName: profile.displayName ?? null, status: 'draft', hidden: false, flags: new Set(),
        eventType: body.eventType as MockEvent['eventType'], title: String(body.title), purpose: String(body.purpose),
        placeId: String(body.placeId), targetSpeciesIds: (body.targetSpeciesIds as string[]) ?? [],
        meetingLatitude: Number(body.meetingLatitude), meetingLongitude: Number(body.meetingLongitude),
        meetingNote: (body.meetingNote as string) || null, startAt: String(body.startAt), endAt: String(body.endAt),
        safetyNotes: (body.safetyNotes as string) || null, ...landOf(String(body.placeId)),
        chatLink: (body.chatLink as string) || null, capacity: (body.capacity as number) ?? null,
        participants: new Map(), checkins: new Map(),
      })
      return HttpResponse.json({ event_id: id, status: 'draft' }, { status: 201 })
    }),
    http.get(url('/api/v1/events/:id/summary'), ({ params, request }) => {
      seed(); completeExpired()
      const event = events.get(String(params.id))
      const viewer = deps.profileFor(request)?.id ?? null
      if (!event || ((event.hidden || event.status === 'draft') && event.hostProfileId !== viewer)) return problem(404, 'event_not_found', 'Not found')
      if (event.status !== 'completed') return problem(409, 'event_not_completed', 'Summary is available after completion.')
      const next = [...events.values()].filter((item) => item.id !== event.id && item.placeId === event.placeId && isLive(item) && Date.parse(item.startAt) > Date.now())
        .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))[0]
      return HttpResponse.json({
        reports_submitted_count: 0, distinct_species_count: 0, place_id: event.placeId, place_name: placeOf(event.placeId)?.name ?? 'Mapped place',
        start_at: event.startAt, end_at: event.endAt, next_event: next ? { event_id: next.id, start_at: next.startAt } : null,
      })
    }),
    http.get(url('/api/v1/events/:id'), ({ params, request }) => {
      seed(); completeExpired()
      const event = events.get(String(params.id))
      const viewer = deps.profileFor(request)?.id ?? null
      if (!event || ((event.status === 'draft' || event.hidden) && event.hostProfileId !== viewer)) return problem(404, 'event_not_found', 'Not found')
      return HttpResponse.json(serialize(event, viewer, true))
    }),
    http.patch(url('/api/v1/events/:id'), async ({ params, request }) => {
      const profile = deps.profileFor(request)
      if (!profile) return problem(401, 'session_required', 'Sign in again.')
      const event = events.get(String(params.id))
      if (!event) return problem(404, 'event_not_found', 'Event not found.')
      if (event.hostProfileId !== profile.id) return problem(403, 'forbidden', 'Forbidden')
      const body = await request.json() as Record<string, unknown>
      if (body.restore) {
        // Mirrors the backend: only a hidden event has a flag tally to clear.
        if (!event.hidden) return problem(409, 'event_not_hidden', 'This event is not hidden.')
        if (event.status === 'cancelled') return problem(409, 'invalid_status_transition', 'A manually cancelled event cannot be restored.')
        event.hidden = false; event.flags.clear()
        return HttpResponse.json(serialize(event, profile.id, true))
      }
      if (event.status !== 'draft' && event.status !== 'published') return problem(409, 'invalid_status_transition', 'Only draft or published events can be edited.')
      if (body.status !== undefined && body.status !== 'draft' && body.status !== 'published') return problem(422, 'invalid_status_transition', 'Use cancel or the lifecycle worker for this status.')
      if (!validChatLink(body.chatLink)) return problem(422, 'validation_error', 'chat_link must use https')
      const locked = ['placeId', 'meetingLatitude', 'meetingLongitude', 'startAt', 'endAt', 'eventType']
      const changed = (key: string) => {
        const next = body[key]
        const current = event[key as keyof MockEvent]
        if (next === undefined) return false
        if (key === 'startAt' || key === 'endAt') return Date.parse(String(next)) !== Date.parse(String(current))
        return next !== current
      }
      if (event.checkins.size && locked.some(changed)) return problem(409, 'event_fields_locked', 'Event fields are locked after activity.')
      const merged = { ...event, ...body } as Record<string, unknown>
      const errors = validateDraft(merged, false)
      if (errors.length) return draftProblem(errors)
      const land = landProblem(merged)
      if (land) return land
      if (body.status === 'published') {
        if (Date.parse(String(merged.endAt)) <= Date.now()) return problem(422, 'event_already_ended', 'Set an end time in the future before publishing.')
        if ([...events.values()].filter((item) => item.id !== event.id && item.hostProfileId === profile.id && countsTowardCap(item)).length >= MAX_LIVE_EVENTS) return capProblem()
      }
      if (body.status === 'draft' && event.checkins.size) return problem(409, 'invalid_status_transition', 'An event with activity cannot return to draft.')
      Object.assign(event, Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'restore' && key !== 'id' && key !== 'permissionContext')))
      Object.assign(event, landOf(event.placeId))
      return HttpResponse.json(serialize(event, profile.id, true))
    }),
    http.delete(url('/api/v1/events/:id'), ({ params, request }) => {
      const profile = deps.profileFor(request)
      const event = events.get(String(params.id))
      if (!event) return problem(404, 'event_not_found', 'Event not found.')
      if (!profile) return problem(401, 'session_required', 'Sign in again.')
      if (event.hostProfileId !== profile.id) return problem(403, 'forbidden', 'Forbidden')
      completeExpired()
      if (event.status === 'completed') return problem(409, 'invalid_status_transition', 'Only draft or published events can be cancelled.')
      event.status = 'cancelled'
      return new HttpResponse(null, { status: 204 })
    }),
    http.post(url('/api/v1/events/:id/participants'), ({ params, request }) => {
      const profile = deps.profileFor(request)
      if (!profile) return problem(401, 'session_required', 'Sign in again.')
      const event = events.get(String(params.id))
      if (!event) return problem(404, 'event_not_found', 'Event not found.')
      if (event.status !== 'published' || event.hidden) return problem(409, 'event_not_joinable', 'This event is not open for joining.')
      // Backend: one row per (event, identity); a repeat join returns it, and a
      // withdrawn participation is re-activated rather than duplicated.
      const existing = event.participants.get(profile.id)
      const participation = existing
        ? { ...existing, status: 'joined' as const }
        : { id: crypto.randomUUID(), status: 'joined' as const, joinedAt: new Date().toISOString() }
      event.participants.set(profile.id, participation)
      return HttpResponse.json({ participation_id: participation.id, event_id: event.id, joined_at: participation.joinedAt, status: 'joined' }, { status: 201 })
    }),
    http.delete(url('/api/v1/events/:id/participants/:participationId'), ({ params, request }) => {
      const profile = deps.profileFor(request)
      const event = events.get(String(params.id))
      if (!profile) return problem(401, 'session_required', 'Sign in again.')
      const owned = event ? [...event.participants.entries()].find(([, item]) => item.id === params.participationId) : undefined
      if (!owned) return problem(404, 'participation_not_found', 'Not found')
      if (owned[0] !== profile.id) return problem(403, 'forbidden', 'Forbidden')
      const participation = owned[1]
      participation.status = 'withdrawn'
      return new HttpResponse(null, { status: 204 })
    }),
    http.post(url('/api/v1/events/:id/check-in'), async ({ params, request }) => {
      const profile = deps.profileFor(request)
      if (!profile) return problem(401, 'session_required', 'Sign in again.')
      const event = events.get(String(params.id))
      if (!event) return problem(404, 'event_not_found', 'Event not found.')
      const body = await request.json() as { latitude: number; longitude: number; accuracyM: number; capturedAt?: string }
      const now = Date.now()
      const fix = body.capturedAt ? Date.parse(body.capturedAt) : Number.NaN
      if (!Number.isFinite(fix) || fix < now - 5 * 60_000 || fix > now + 60_000) return problem(422, 'fresh_location_required', 'Get a fresh location fix and try again.')
      if (event.status !== 'published' || event.hidden) return problem(422, 'event_not_published', 'Event is not published.')
      if (!(body.accuracyM <= 250)) return problem(422, 'accuracy_too_low', 'GPS accuracy must be 250m or better.')
      if (now < Date.parse(event.startAt) - CHECKIN_GRACE_MS || now > Date.parse(event.endAt)) return problem(422, 'outside_time_window', 'Outside the event time window.')
      if (!deps.placeContains(event.placeId, { lat: body.latitude, lng: body.longitude })) return problem(422, 'outside_place', 'Outside the event place.')
      const at = new Date().toISOString()
      event.checkins.set(profile.id, at)
      if (!event.participants.get(profile.id) || event.participants.get(profile.id)!.status !== 'joined') {
        event.participants.set(profile.id, { id: crypto.randomUUID(), status: 'joined', joinedAt: at })
      }
      return HttpResponse.json({ checkin_id: crypto.randomUUID(), checked_in_at: at }, { status: 201 })
    }),
    http.post(url('/api/v1/events/:id/flag'), ({ params, request }) => {
      const profile = deps.profileFor(request)
      if (!profile) return problem(401, 'session_required', 'Sign in again.')
      const event = events.get(String(params.id))
      if (!event) return problem(404, 'event_not_found', 'Not found')
      if (event.hostProfileId === profile.id) return problem(403, 'self_flag_forbidden', 'Hosts cannot flag their own event.')
      if (event.status === 'draft') return problem(404, 'event_not_found', 'Not found')
      if (event.status !== 'published') return problem(409, 'event_not_flaggable', 'Only a published event can be reported.')
      event.flags.add(profile.id)
      if (event.flags.size >= HIDE_THRESHOLD) event.hidden = true
      return HttpResponse.json({ flagged: true, hidden: event.hidden })
    }),

    // ---- Epic 7 guided missions -----------------------------------------
    http.post(url('/api/v1/guided-missions'), async ({ request }) => {
      const profile = deps.profileFor(request)
      if (!profile) return problem(401, 'session_required', 'Sign in again.')
      const body = await request.json() as { placeId?: string; watchlistSpeciesIds?: string[]; datasetVersion?: string }
      if (!body.placeId || !placeOf(body.placeId)) return problem(422, 'place_not_found', 'Place not found.')
      const species = [...new Set((body.watchlistSpeciesIds ?? []).map((id) => id.trim()).filter(Boolean))]
      if (!species.length) return problem(422, 'empty_watchlist', 'The watchlist is empty.')
      const active = [...missions.values()].find((item) => item.profileId === profile.id && item.placeId === body.placeId && item.status === 'active')
      if (active) return HttpResponse.json(missionJson(active))
      const now = new Date().toISOString()
      const mission: MockMission = {
        missionId: crypto.randomUUID(), profileId: profile.id, placeId: body.placeId, status: 'active',
        datasetVersion: body.datasetVersion ?? 'unknown', selectedSpeciesId: null, startedAt: now, updatedAt: now, completedAt: null,
        plants: species.map((speciesId) => ({ speciesId, state: 'not_checked', noTargetFound: false, updatedAt: now })),
      }
      missions.set(mission.missionId, mission)
      saveMissions()
      return HttpResponse.json(missionJson(mission), { status: 201 })
    }),
    http.get(url('/api/v1/guided-missions/active'), ({ request }) => {
      const profile = deps.profileFor(request)
      if (!profile) return problem(401, 'session_required', 'Sign in again.')
      const params = new URL(request.url).searchParams
      const placeId = params.get('place_id') ?? params.get('placeId')
      const active = [...missions.values()].find((item) => item.profileId === profile.id && item.placeId === placeId && item.status === 'active')
      return active ? HttpResponse.json(missionJson(active)) : problem(404, 'mission_not_found', 'No active mission.')
    }),
    http.get(url('/api/v1/guided-missions/:id/summary'), ({ params, request }) => {
      const result = ownMission(request, String(params.id))
      return result.error ?? HttpResponse.json(missionSummary(result.mission))
    }),
    http.get(url('/api/v1/guided-missions/:id'), ({ params, request }) => {
      const result = ownMission(request, String(params.id))
      return result.error ?? HttpResponse.json(missionJson(result.mission))
    }),
    http.patch(url('/api/v1/guided-missions/:id'), async ({ params, request }) => {
      const result = ownMission(request, String(params.id))
      if (result.error) return result.error
      const { mission } = result
      if (mission.status !== 'active') return problem(409, 'mission_completed', 'This mission is complete.')
      const body = await request.json() as { selectedSpeciesId: string | null }
      if (body.selectedSpeciesId !== null && !mission.plants.some((plant) => plant.speciesId === body.selectedSpeciesId)) return problem(422, 'species_not_in_mission', 'That plant is not in this mission.')
      mission.selectedSpeciesId = body.selectedSpeciesId
      mission.updatedAt = new Date().toISOString()
      saveMissions()
      return HttpResponse.json(missionJson(mission))
    }),
    http.put(url('/api/v1/guided-missions/:id/plants/:speciesId'), async ({ params, request }) => {
      const result = ownMission(request, String(params.id))
      if (result.error) return result.error
      const { mission } = result
      if (mission.status !== 'active') return problem(409, 'mission_completed', 'This mission is complete.')
      const plant = mission.plants.find((item) => item.speciesId === params.speciesId)
      if (!plant) return problem(404, 'species_not_in_mission', 'That plant is not in this mission.')
      const body = await request.json() as { state: MockMission['plants'][number]['state']; noTargetFound?: boolean }
      if (body.noTargetFound && body.state !== 'looked_for') return problem(422, 'no_find_requires_looked_for', 'Mark the plant as looked for first.')
      if (body.noTargetFound && deps.reportsForMission(mission.missionId).some((report) => report.speciesId === plant.speciesId)) {
        return problem(409, 'sighting_already_submitted', 'A sighting of this plant was submitted during this mission.')
      }
      plant.noTargetFound = body.state === 'looked_for' ? (body.noTargetFound ?? (plant.state === 'looked_for' && plant.noTargetFound)) : false
      plant.state = body.state
      plant.updatedAt = mission.updatedAt = new Date().toISOString()
      saveMissions()
      return HttpResponse.json(missionJson(mission))
    }),
    http.post(url('/api/v1/guided-missions/:id/complete'), ({ params, request }) => {
      const result = ownMission(request, String(params.id))
      if (result.error) return result.error
      const { mission } = result
      if (mission.status === 'active') {
        mission.status = 'completed'
        mission.completedAt = mission.updatedAt = new Date().toISOString()
        saveMissions()
      }
      return HttpResponse.json(missionSummary(mission))
    }),
  ]
}

