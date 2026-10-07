// Display helpers shared by every Epic 9 screen. Times are stored in UTC and
// always rendered in the viewer's local time (AC 9.2.1), in English.
import { approvedSpeciesDataset } from '@shared/catalogue'
import { ENGLISH_LOCALE } from '@/utils/date-time'
import type { CommunityEvent } from '@/services/api/events'

const dayFormat = new Intl.DateTimeFormat(ENGLISH_LOCALE, { weekday: 'short', day: 'numeric', month: 'short' })
const longDayFormat = new Intl.DateTimeFormat(ENGLISH_LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const timeFormat = new Intl.DateTimeFormat(ENGLISH_LOCALE, { hour: '2-digit', minute: '2-digit', hour12: false })
const monthFormat = new Intl.DateTimeFormat(ENGLISH_LOCALE, { month: 'short' })

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()

/** "Sat 12 Oct · 08:00–10:30", or both dates when an event spans midnight. */
export function formatEventWindow(startAt: string, endAt: string) {
  const start = new Date(startAt)
  const end = new Date(endAt)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 'Time unavailable'
  return sameDay(start, end)
    ? `${dayFormat.format(start)} · ${timeFormat.format(start)}–${timeFormat.format(end)}`
    : `${dayFormat.format(start)} ${timeFormat.format(start)} – ${dayFormat.format(end)} ${timeFormat.format(end)}`
}

/** Start date, plus the end date when the event runs past midnight. */
export function formatEventDays(startAt: string, endAt: string) {
  const start = new Date(startAt)
  const end = new Date(endAt)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || sameDay(start, end)) return formatEventDay(startAt)
  return `${formatEventDay(startAt)} – ${formatEventDay(endAt)}`
}

export function formatEventDay(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : longDayFormat.format(date)
}

export function formatEventTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '--:--' : timeFormat.format(date)
}

/** The calendar tile on each card. */
export function eventDateTile(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return { month: '—', day: '—' }
  return { month: monthFormat.format(date).toUpperCase(), day: String(date.getDate()) }
}

export const placeTypeLabels: Record<NonNullable<CommunityEvent['placeType']>, string> = {
  park: 'Park',
  forest: 'Forest',
  wood: 'Woodland',
  trail: 'Trail',
}

export function speciesName(id: string) {
  const record = approvedSpeciesDataset.records.find((item) => item.species_id === id)
  return record?.common_names[0] ?? record?.scientific_name ?? id
}

/** Target species as display names, preferring names the API already resolved. */
export function targetSpeciesNames(event: Pick<CommunityEvent, 'targetSpeciesIds' | 'targetSpecies'>) {
  if (event.targetSpecies?.length) return event.targetSpecies.map((item) => item.name)
  return event.targetSpeciesIds.map(speciesName)
}

export const hostLabel = (event: Pick<CommunityEvent, 'hostDisplayName'>) => event.hostDisplayName?.trim() || 'Community host'

export const statusLabels: Record<CommunityEvent['status'], string> = {
  draft: 'Draft',
  published: 'Published',
  cancelled: 'Cancelled',
  completed: 'Completed',
}
