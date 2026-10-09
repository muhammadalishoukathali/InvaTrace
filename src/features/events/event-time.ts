// Scheduling rules for hosting an event. They mirror the API's
// _assert_event_window so the form never offers a time the server refuses.

export const SLOT_MINUTES = 15
export const START_GRACE_MINUTES = 15
export const MAX_DURATION_MINUTES = 12 * 60
export const MAX_LEAD_DAYS = 365
export const DURATION_CHOICES = [30, 60, 90, 120, 180, 240, 360, 480, 720] as const
export const DEFAULT_DURATION_MINUTES = 120

const MINUTE = 60_000

/** First selectable start: now rounded up to the next 15-minute slot. */
export function earliestStart(now: Date): Date {
  const slot = SLOT_MINUTES * MINUTE
  return new Date(Math.ceil(now.getTime() / slot) * slot)
}

export function latestStart(now: Date): Date {
  const limit = new Date(now)
  limit.setDate(limit.getDate() + MAX_LEAD_DAYS)
  return limit
}

export const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())
export const sameDay = (a: Date, b: Date) => startOfDay(a).getTime() === startOfDay(b).getTime()

export function isStartSelectable(start: Date, now: Date): boolean {
  return start >= earliestStart(now) && start <= latestStart(now)
}

export function isDaySelectable(day: Date, now: Date): boolean {
  const lastSlot = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 60 - SLOT_MINUTES)
  return lastSlot >= earliestStart(now) && startOfDay(day) <= latestStart(now)
}

export function isHourSelectable(day: Date, hour: number, now: Date): boolean {
  return minuteSlots().some((minute) => isStartSelectable(at(day, hour, minute), now))
}

export const minuteSlots = () => Array.from({ length: 60 / SLOT_MINUTES }, (_, index) => index * SLOT_MINUTES)

export const at = (day: Date, hour: number, minute: number) =>
  new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute)

/** Keep the host's chosen time of day when they switch dates, if it is still open. */
export function startForDay(day: Date, now: Date, previous: Date | null): Date | null {
  const candidates = [
    previous && at(day, previous.getHours(), previous.getMinutes()),
    at(day, 9, 0),
  ].filter((value): value is Date => Boolean(value))
  const kept = candidates.find((value) => isStartSelectable(value, now))
  if (kept) return kept
  const first = earliestStart(now)
  return sameDay(first, day) ? first : null
}

export const minutesBetween = (start: Date, end: Date) => Math.round((end.getTime() - start.getTime()) / MINUTE)
export const addMinutes = (date: Date, minutes: number) => new Date(date.getTime() + minutes * MINUTE)

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (!hours) return `${rest} min`
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}

/**
 * Error for a chosen window, or null when it can be saved. A start that the
 * host did not change (editing a running event) is not judged against "now".
 */
export function eventWindowError(start: Date | null, end: Date | null, now: Date, startChanged = true): string | null {
  if (!start || !end) return 'Choose a date, a start time and how long the event lasts.'
  if (end <= start) return 'The end time must be after the start time.'
  if (minutesBetween(start, end) > MAX_DURATION_MINUTES) return 'An event can last at most 12 hours.'
  if (end <= now) return 'The end time must be in the future.'
  if (!startChanged) return null
  if (start.getTime() < now.getTime() - START_GRACE_MINUTES * MINUTE) return 'That start time has already passed. Choose a later time.'
  if (start > latestStart(now)) return 'Events can be scheduled up to one year ahead.'
  return null
}
