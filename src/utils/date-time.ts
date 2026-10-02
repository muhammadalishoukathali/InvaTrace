/** Product dates stay English while retaining the user's local time zone. */
export const ENGLISH_LOCALE = 'en-GB'

export function parseLocalDateTime(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const [year, month, day, hour, minute] = match.slice(1).map(Number)
  if (year < 1000 || year > 9999) return null
  const date = new Date(year, month - 1, day, hour, minute)
  // Date rolls invalid dates forward; reject them instead of silently changing input.
  return date.getFullYear() === year && date.getMonth() === month - 1
    && date.getDate() === day && date.getHours() === hour && date.getMinutes() === minute
    ? date : null
}

export function toLocalDateTimeValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
