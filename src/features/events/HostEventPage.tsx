import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { BackLink } from '@/components/BackLink'
import { EnglishDateTimeField } from '@/components/EnglishDateTimeField'
import { Icon } from '@/components/Icon'
import { api, ApiError } from '@/services/api-client'
import { eventsApi, type EventDraft, type EventType } from '@/services/api/events'
import type { PlaceDetail, PlaceSummary } from '@/types'
import { parseLocalDateTime, toLocalDateTimeValue } from '@/utils/date-time'
import { EventMap } from './EventMap'
import { EventState } from './EventCard'
import { SpeciesPicker } from './SpeciesPicker'
import { eventTypeLabels } from './event-types'
import { formatEventWindow, placeTypeLabels, speciesName } from './event-format'
import './events.css'

const DEFAULT_SAFETY_NOTES = 'Observe and report only unless the land manager has given permission. Wear closed shoes, bring water, stay on marked paths and keep away from water edges.'
const initial: EventDraft = {
  title: '', purpose: '', eventType: 'survey', placeId: '', meetingLatitude: Number.NaN, meetingLongitude: Number.NaN,
  startAt: '', endAt: '', targetSpeciesIds: [], permissionContext: 'unknown', safetyNotes: DEFAULT_SAFETY_NOTES,
}
type FormErrors = Partial<Record<keyof EventDraft | 'times' | 'meeting', string>>
const STEPS = ['Activity', 'Place', 'Time & safety', 'Review'] as const

const TYPE_HELP: Record<EventType, string> = {
  survey: 'Find and record invasive plants. The safest default.',
  removal: 'Safe removal. Needs permission from the land manager before you can publish.',
  monitoring: 'Revisit earlier sightings to check for regrowth.',
  other: 'Another activity — describe it in the purpose.',
}

/** US 9.6: any identity can host. Events start as drafts until published. */
export function HostEventPage() {
  const queryClient = useQueryClient()
  const { eventId } = useParams()
  const edit = Boolean(eventId)
  const navigate = useNavigate()
  const [draft, setDraft] = useState<EventDraft>(initial)
  const [step, setStep] = useState(1)
  const [errors, setErrors] = useState<FormErrors>({})
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [placeSearch, setPlaceSearch] = useState('')
  const initialized = useRef<string | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const places = useQuery({ queryKey: ['places'], queryFn: () => api<{ items: PlaceSummary[] }>('/api/v1/places') })
  const selectedPlace = useQuery({
    queryKey: ['place', draft.placeId],
    queryFn: () => api<PlaceDetail>(`/api/v1/places/${draft.placeId}`),
    enabled: Boolean(draft.placeId),
  })
  const existing = useQuery({ queryKey: ['event', eventId], queryFn: () => eventsApi.get(eventId!), enabled: edit })

  useEffect(() => {
    const item = existing.data
    if (!item || initialized.current === eventId) return
    initialized.current = eventId ?? null
    setDraft({
      title: item.title, purpose: item.purpose, eventType: item.eventType, placeId: item.placeId,
      meetingLatitude: item.meetingLatitude, meetingLongitude: item.meetingLongitude, meetingNote: item.meetingNote ?? '',
      startAt: localInput(item.startAt), endAt: localInput(item.endAt), targetSpeciesIds: item.targetSpeciesIds,
      safetyNotes: item.safetyNotes ?? '', permissionContext: item.permissionContext, chatLink: item.chatLink ?? '',
    })
  }, [eventId, existing.data])

  // Move focus to the step heading so keyboard and screen-reader users land at
  // the start of each new step.
  useEffect(() => { headingRef.current?.focus() }, [step])

  const save = useMutation({
    mutationFn: async (publish: boolean) => {
      // validate() has already confirmed both values parse as local date-times.
      const wire = { ...draft, startAt: parseLocalDateTime(draft.startAt)!.toISOString(), endAt: parseLocalDateTime(draft.endAt)!.toISOString() }
      if (edit) {
        const patch: Partial<EventDraft> = existing.data?.status === 'draft' && publish ? { ...wire, status: 'published' } : wire
        if (existing.data?.activityLocked) {
          delete patch.placeId; delete patch.meetingLatitude; delete patch.meetingLongitude
          delete patch.startAt; delete patch.endAt; delete patch.eventType
        }
        return eventsApi.update(eventId!, patch)
      }
      if (createdId) return eventsApi.update(createdId, { ...wire, ...(publish ? { status: 'published' as const } : {}) })
      const created = await eventsApi.create(wire)
      setCreatedId(created.eventId)
      return publish ? eventsApi.update(created.eventId, { status: 'published' }) : created
    },
    onSuccess: async (value) => {
      const id = 'eventId' in value ? value.eventId : value.id
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['events'] }),
        queryClient.invalidateQueries({ queryKey: ['event', id] }),
      ])
      navigate(`/events/${id}`)
    },
  })

  const filteredPlaces = useMemo(() => {
    const term = placeSearch.trim().toLowerCase()
    const all = places.data?.items ?? []
    return (term ? all.filter((place) => place.displayName.toLowerCase().includes(term)) : all).slice(0, 40)
  }, [places.data, placeSearch])

  const set = <K extends keyof EventDraft>(key: K, value: EventDraft[K]) => {
    setDraft((previous) => ({ ...previous, [key]: value }))
    setErrors((previous) => ({
      ...previous, [key]: undefined,
      ...(key === 'startAt' || key === 'endAt' ? { times: undefined } : {}),
      ...(key === 'meetingLatitude' || key === 'meetingLongitude' ? { meeting: undefined } : {}),
    }))
  }
  const setMeeting = (latitude: number, longitude: number) => {
    setDraft((previous) => ({ ...previous, meetingLatitude: latitude, meetingLongitude: longitude }))
    setErrors((previous) => ({ ...previous, meeting: undefined }))
  }

  // When a place is chosen, start the meeting point in the middle of it so the
  // host only needs to nudge it, not hunt for it.
  useEffect(() => {
    if (!selectedPlace.data || edit || Number.isFinite(draft.meetingLatitude)) return
    const centre = geometryCentre(selectedPlace.data.geometry)
    if (centre) setMeeting(centre.latitude, centre.longitude)
  }, [selectedPlace.data, edit, draft.meetingLatitude])

  const validate = (upTo: number) => {
    const next: FormErrors = {}
    if (upTo >= 1) {
      if (!draft.title.trim()) next.title = 'Enter an event title.'
      if (!draft.purpose.trim()) next.purpose = 'Describe what the group will do.'
    }
    if (upTo >= 2) {
      if (!draft.placeId) next.placeId = 'Choose a mapped place.'
      if (!validMeeting(draft)) next.meeting = 'Tap the map inside the place to set a meeting point in Malaysia.'
    }
    if (upTo >= 3) {
      const start = parseLocalDateTime(draft.startAt)
      const end = parseLocalDateTime(draft.endAt)
      if (!start || !end || end <= start) {
        next.times = 'Enter a start time and an end time after it.'
      } else if (!existing.data?.activityLocked && end.getTime() <= Date.now()) {
        next.times = 'The end time must be in the future.'
      }
      if (draft.eventType === 'removal' && draft.permissionContext !== 'explicit_permission') {
        next.permissionContext = 'A removal event needs confirmed permission from the land manager before it can be published.'
      }
      if (draft.permissionContext === 'explicit_permission' && !draft.safetyNotes?.trim()) {
        next.safetyNotes = 'State who gave permission and any conditions in the safety notes.'
      }
    }
    if (upTo >= 4 && draft.chatLink?.trim() && !validChatLink(draft.chatLink)) next.chatLink = 'Enter a valid https:// link without a username or password.'
    setErrors(next)
    const firstInvalidStep = (next.title || next.purpose) ? 1 : (next.placeId || next.meeting) ? 2 : (next.times || next.permissionContext || next.safetyNotes) ? 3 : 4
    return { ok: Object.keys(next).length === 0, firstInvalidStep }
  }

  if (edit && existing.isLoading) return <EventState text="Loading event editor…" />
  if (edit && (existing.isError || !existing.data)) return <EventState error text="This event cannot be edited." />
  if (edit && !existing.data!.isHost) return <EventState error text="Only the event host can edit this event." />
  if (edit && !['draft', 'published'].includes(existing.data!.status)) return <EventState error text="Cancelled and completed events can no longer be edited." />
  const locked = Boolean(existing.data?.activityLocked)
  const next = () => { const result = validate(step); if (result.ok) setStep(step + 1); else setStep(Math.min(step, result.firstInvalidStep)) }
  const submit = (publish: boolean) => { const result = validate(4); if (result.ok) save.mutate(publish); else setStep(result.firstInvalidStep) }
  const point = validMeeting(draft) ? { latitude: draft.meetingLatitude, longitude: draft.meetingLongitude } : undefined
  const placeName = selectedPlace.data?.displayName ?? places.data?.items.find((place) => place.placeId === draft.placeId)?.displayName

  return (
    <section className="events-page event-narrow host-event">
      <BackLink to={edit ? `/events/${eventId}` : '/events'}>{edit ? 'Back to event' : 'Back to events'}</BackLink>
      <header className="event-detail__header">
        <h2>{edit ? 'Edit event' : 'Host a community event'}</h2>
        {!edit && <p className="event-detail__host">No account needed. It stays a private draft until you publish it.</p>}
      </header>

      <ol className="host-stepper" aria-label="Progress">
        {STEPS.map((label, index) => (
          <li key={label} className={index + 1 === step ? 'is-current' : index + 1 < step ? 'is-done' : ''} aria-current={index + 1 === step ? 'step' : undefined}>
            <span aria-hidden>{index + 1 < step ? <Icon name="Check" size={13} /> : index + 1}</span>
            <span className="host-stepper__label">{label}</span>
          </li>
        ))}
      </ol>
      {locked && <p className="event-banner" role="status">People have checked in or reported, so the place, meeting point, times and event type are locked. To change them, cancel and create a new event.</p>}

      <div className="host-step">
        <h3 ref={headingRef} tabIndex={-1}>Step {step} of 4 · {STEPS[step - 1]}</h3>

        {step === 1 && (
          <>
            <label className="event-field">
              <span>Event title</span>
              <input value={draft.title} maxLength={120} placeholder="e.g. Saturday survey at the lake" onChange={(event) => set('title', event.target.value)} aria-invalid={Boolean(errors.title)} />
              {errors.title && <small role="alert">{errors.title}</small>}
            </label>
            <label className="event-field">
              <span>Purpose</span>
              <textarea rows={4} value={draft.purpose} placeholder="What will the group do, and what should people bring?" onChange={(event) => set('purpose', event.target.value)} aria-invalid={Boolean(errors.purpose)} />
              {errors.purpose && <small role="alert">{errors.purpose}</small>}
            </label>
            <fieldset className="event-type-picker" disabled={locked}>
              <legend>What kind of event is it?</legend>
              {(Object.keys(eventTypeLabels) as EventType[]).map((type) => (
                <label key={type} className={draft.eventType === type ? 'is-selected' : ''}>
                  <input type="radio" name="event-type" value={type} checked={draft.eventType === type} onChange={() => set('eventType', type)} />
                  <span>
                    <strong>{eventTypeLabels[type]}</strong>
                    <small>{TYPE_HELP[type]}</small>
                  </span>
                </label>
              ))}
            </fieldset>
          </>
        )}

        {step === 2 && (
          <>
            <div className="event-field">
              <label htmlFor="place-search">Mapped place</label>
              {draft.placeId && placeName ? (
                <div className="host-place-chosen">
                  <Icon name="MapPin" size={17} />
                  <span><strong>{placeName}</strong>{selectedPlace.data && <small>{placeTypeLabels[selectedPlace.data.placeType]}</small>}</span>
                  {!locked && <button type="button" className="event-text-button" onClick={() => { set('placeId', ''); setMeeting(Number.NaN, Number.NaN) }}>Change</button>}
                </div>
              ) : (
                <>
                  <input id="place-search" type="search" value={placeSearch} placeholder="Search parks, forests and woodlands" onChange={(event) => setPlaceSearch(event.target.value)} aria-invalid={Boolean(errors.placeId)} disabled={locked} />
                  {places.isLoading && <small role="status">Loading mapped places…</small>}
                  {places.isError && <small role="alert">Mapped places could not be loaded. <button type="button" className="event-text-button" onClick={() => void places.refetch()}>Try again</button></small>}
                  {places.data && (
                    <ul className="host-place-results" aria-label="Matching places">
                      {filteredPlaces.map((place) => (
                        <li key={place.placeId}>
                          <button type="button" onClick={() => { set('placeId', place.placeId); setMeeting(Number.NaN, Number.NaN); setPlaceSearch('') }}>
                            <strong>{place.displayName}</strong>
                            <small>{placeTypeLabels[place.placeType]}</small>
                          </button>
                        </li>
                      ))}
                      {filteredPlaces.length === 0 && <li className="species-dialog__empty">No mapped place matches “{placeSearch}”.</li>}
                    </ul>
                  )}
                </>
              )}
              {errors.placeId && <small role="alert">{errors.placeId}</small>}
            </div>
            {draft.placeId && (
              <div className="event-field">
                <span>Meeting point</span>
                <small className="event-muted">{locked ? 'Locked after check-ins began.' : 'Tap the map inside the dashed boundary. Check-in only works inside this area.'}</small>
                <EventMap
                  point={point}
                  boundary={selectedPlace.data?.geometry ?? null}
                  onPointChange={locked ? undefined : (value) => setMeeting(value.latitude, value.longitude)}
                  label="Choose the meeting point on the map"
                  className="event-map-wrap--picker"
                />
                <p className="host-coordinates">
                  {point ? `Meeting point ${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}` : 'No meeting point yet'}
                  {!locked && selectedPlace.data && (
                    <button type="button" className="event-text-button" onClick={() => { const centre = geometryCentre(selectedPlace.data!.geometry); if (centre) setMeeting(centre.latitude, centre.longitude) }}>
                      Use the centre of the place
                    </button>
                  )}
                </p>
                {errors.meeting && <small role="alert">{errors.meeting}</small>}
              </div>
            )}
            <label className="event-field">
              <span>How to find the group (optional)</span>
              <input maxLength={500} value={draft.meetingNote ?? ''} placeholder="e.g. By the main gate, next to the noticeboard" onChange={(event) => set('meetingNote', event.target.value)} />
            </label>
          </>
        )}

        {step === 3 && (
          <>
            <div className="host-times">
              <EnglishDateTimeField label="Starts" disabled={locked} value={draft.startAt} onChange={(value) => set('startAt', value)} />
              <EnglishDateTimeField label="Ends" disabled={locked} value={draft.endAt} onChange={(value) => set('endAt', value)} />
            </div>
            {errors.times && <p className="event-inline-alert" role="alert">{errors.times}</p>}
            <fieldset className="event-choice-list">
              <legend>Permission from the land manager</legend>
              <label>
                <input type="radio" name="permission" checked={draft.permissionContext === 'unknown'} onChange={() => set('permissionContext', 'unknown')} />
                <span><strong>Not confirmed</strong><small>Participants observe and report only.</small></span>
              </label>
              <label>
                <input type="radio" name="permission" checked={draft.permissionContext === 'explicit_permission'} onChange={() => set('permissionContext', 'explicit_permission')} />
                <span><strong>Confirmed</strong><small>Say who gave permission in the safety notes. Each person’s removal still goes through the InvaTrace checks on the day.</small></span>
              </label>
            </fieldset>
            {errors.permissionContext && <p className="event-inline-alert" role="alert">{errors.permissionContext}</p>}
            <label className="event-field">
              <span>Safety notes</span>
              <textarea rows={4} value={draft.safetyNotes ?? ''} onChange={(event) => set('safetyNotes', event.target.value)} aria-invalid={Boolean(errors.safetyNotes)} />
              {errors.safetyNotes && <small role="alert">{errors.safetyNotes}</small>}
            </label>
          </>
        )}

        {step === 4 && (
          <>
            <SpeciesPicker label="Target species" value={draft.targetSpeciesIds} onChange={(value) => set('targetSpeciesIds', value)} emptyLabel="Any supported invasive plant" />
            <label className="event-field">
              <span>Group chat link (optional)</span>
              <input type="url" inputMode="url" maxLength={500} value={draft.chatLink ?? ''} onChange={(event) => set('chatLink', event.target.value)} placeholder="https://chat.whatsapp.com/…" aria-invalid={Boolean(errors.chatLink)} />
              <small className="event-muted">Only people who join can see it. It opens outside InvaTrace.</small>
              {errors.chatLink && <small role="alert">{errors.chatLink}</small>}
            </label>
            <section className="host-review" aria-label="Review">
              <h4>Review</h4>
              <dl>
                <div><dt>Event</dt><dd>{draft.title || '—'} · {eventTypeLabels[draft.eventType]}</dd></div>
                <div><dt>Place</dt><dd>{placeName ?? '—'}</dd></div>
                <div><dt>When</dt><dd>{parseLocalDateTime(draft.startAt) && parseLocalDateTime(draft.endAt) ? formatEventWindow(parseLocalDateTime(draft.startAt)!.toISOString(), parseLocalDateTime(draft.endAt)!.toISOString()) : '—'}</dd></div>
                <div><dt>Plants</dt><dd>{draft.targetSpeciesIds.length ? draft.targetSpeciesIds.map(speciesName).join(', ') : 'Any supported invasive plant'}</dd></div>
                <div><dt>Permission</dt><dd>{draft.permissionContext === 'explicit_permission' ? 'Confirmed by host' : 'Not confirmed — observe and report'}</dd></div>
              </dl>
              <p className="event-banner">Hosting or joining an event never grants permission to remove plants. The default activity is to observe and report.</p>
            </section>
          </>
        )}
      </div>

      <div className="host-actions">
        {step > 1 && <button type="button" className="event-button" onClick={() => setStep(step - 1)}>Back</button>}
        {step < 4
          ? <button type="button" className="event-button event-button--primary" onClick={next}>Continue</button>
          : edit && existing.data?.status !== 'draft'
            ? <button type="button" className="event-button event-button--primary" disabled={save.isPending} onClick={() => submit(false)}>{save.isPending ? 'Saving…' : 'Save changes'}</button>
            : (
              <>
                <button type="button" className="event-button" disabled={save.isPending} onClick={() => submit(false)}>Save draft</button>
                <button type="button" className="event-button event-button--primary" disabled={save.isPending} onClick={() => submit(true)}>{save.isPending ? 'Publishing…' : 'Publish event'}</button>
              </>
            )}
      </div>
      {save.error && <p className="event-inline-alert" role="alert">{save.error instanceof ApiError ? save.error.message : 'The event could not be saved. Try again.'}</p>}
    </section>
  )
}

const localInput = (value: string) => toLocalDateTimeValue(new Date(value))

const validMeeting = (draft: EventDraft) => Number.isFinite(draft.meetingLatitude) && Number.isFinite(draft.meetingLongitude)
  && draft.meetingLatitude >= 0.8 && draft.meetingLatitude <= 7.5 && draft.meetingLongitude >= 99.3 && draft.meetingLongitude <= 119.5

function validChatLink(value: string) {
  try {
    const url = new URL(value)
    return value.length <= 500 && url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password
  } catch {
    return false
  }
}

/** Centre of a place's bounding box; for a trail, its middle vertex (always on the line). */
function geometryCentre(geometry: GeoJSON.Geometry): { latitude: number; longitude: number } | null {
  if (geometry.type === 'LineString' && geometry.coordinates.length) {
    const [longitude, latitude] = geometry.coordinates[Math.floor(geometry.coordinates.length / 2)]
    return { latitude, longitude }
  }
  const coords: number[][] = []
  const visit = (value: unknown): void => {
    if (!Array.isArray(value)) return
    if (typeof value[0] === 'number') { coords.push(value as number[]); return }
    value.forEach(visit)
  }
  if ('coordinates' in geometry) visit(geometry.coordinates)
  if (!coords.length) return null
  const lngs = coords.map((c) => c[0])
  const lats = coords.map((c) => c[1])
  return { latitude: (Math.min(...lats) + Math.max(...lats)) / 2, longitude: (Math.min(...lngs) + Math.max(...lngs)) / 2 }
}
