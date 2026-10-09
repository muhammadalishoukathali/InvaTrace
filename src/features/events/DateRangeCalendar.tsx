import { useMemo, useState } from 'react'
import { Icon } from '@/components/Icon'
import { ENGLISH_LOCALE } from '@/utils/date-time'

export interface DayRange {
  start: Date | null
  end: Date | null
}

interface Props {
  value: DayRange
  onChange: (value: DayRange) => void
  /** How many months ahead of the current one can be browsed. */
  monthsAhead?: number
}

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
const monthTitle = new Intl.DateTimeFormat(ENGLISH_LOCALE, { month: 'long', year: 'numeric' })
const dayLabel = new Intl.DateTimeFormat(ENGLISH_LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const shortDay = new Intl.DateTimeFormat(ENGLISH_LOCALE, { weekday: 'short', day: 'numeric', month: 'short' })

export const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())
const sameDay = (a: Date, b: Date) => startOfDay(a).getTime() === startOfDay(b).getTime()
const daysBetween = (a: Date, b: Date) => Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86_400_000)

/** Whole-day window: midnight on the first day up to midnight after the last. */
export function dayRangeWindow({ start, end }: DayRange): { from: Date | null; to: Date | null } {
  if (!start) return { from: null, to: null }
  const last = end ?? start
  return { from: startOfDay(start), to: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1) }
}

export function formatDayRange({ start, end }: DayRange): string {
  if (!start) return 'Any day'
  if (!end || sameDay(start, end)) return shortDay.format(start)
  return `${shortDay.format(start)} – ${shortDay.format(end)}`
}

/**
 * Pick a first day, then a last day. Times are deliberately absent: filters
 * cover whole days. Past days are never offered because discovery lists only
 * upcoming events.
 */
export function DateRangeCalendar({ value, onChange, monthsAhead = 12 }: Props) {
  const today = startOfDay(new Date())
  const firstMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  const lastMonth = new Date(today.getFullYear(), today.getMonth() + monthsAhead, 1)
  const [view, setView] = useState(() => new Date((value.start ?? today).getFullYear(), (value.start ?? today).getMonth(), 1))
  const [hovered, setHovered] = useState<Date | null>(null)
  const { start, end } = value
  const choosingEnd = Boolean(start && !end)
  // While the last day is still open, preview the range under the pointer.
  const previewEnd = choosingEnd && hovered && start && hovered >= start ? hovered : end

  const cells = useMemo(() => {
    const leading = (view.getDay() + 6) % 7 // Monday-first weeks
    const days = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate()
    return [
      ...Array.from({ length: leading }, () => null),
      ...Array.from({ length: days }, (_, index) => new Date(view.getFullYear(), view.getMonth(), index + 1)),
    ]
  }, [view])

  const choose = (day: Date) => {
    if (!start || end || day < start) onChange({ start: day, end: null })
    else onChange({ start, end: day })
  }

  const describe = (day: Date) => {
    const parts = [dayLabel.format(day)]
    if (sameDay(day, today)) parts.push('today')
    if (start && sameDay(day, start)) parts.push('first day')
    if (end && sameDay(day, end)) parts.push('last day')
    return parts.join(', ')
  }

  const span = start ? daysBetween(start, end ?? start) + 1 : 0
  const status = !start
    ? 'Tap the first day.'
    : !end
      ? `From ${shortDay.format(start)} — now tap the last day, or keep just this day.`
      : `${formatDayRange(value)} · ${span} ${span === 1 ? 'day' : 'days'}`

  return (
    <div className="range-calendar" lang="en">
      <div className="range-calendar__head">
        <button type="button" className="event-icon-button" aria-label="Previous month" disabled={view <= firstMonth} onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}><Icon name="ChevronLeft" size={18} /></button>
        <strong aria-live="polite">{monthTitle.format(view)}</strong>
        <button type="button" className="event-icon-button" aria-label="Next month" disabled={view >= lastMonth} onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}><Icon name="ChevronRight" size={18} /></button>
      </div>
      <div className="range-calendar__grid" role="group" aria-label={`Days in ${monthTitle.format(view)}`} onPointerLeave={() => setHovered(null)}>
        {WEEKDAYS.map((name) => <span key={name} className="range-calendar__weekday" aria-hidden>{name}</span>)}
        {cells.map((cell, index) => {
          if (cell === null) return <span key={`blank-${index}`} aria-hidden />
          const isStart = Boolean(start && sameDay(cell, start))
          const isEnd = Boolean(previewEnd && sameDay(cell, previewEnd))
          const inside = Boolean(start && previewEnd && cell > start && cell < previewEnd)
          const classes = ['range-calendar__day']
          if (sameDay(cell, today)) classes.push('is-today')
          if (inside) classes.push('is-inside')
          if (isStart) classes.push('is-start')
          if (isEnd) classes.push('is-end')
          if (isStart && previewEnd && !sameDay(start!, previewEnd)) classes.push('has-tail')
          if (isEnd && start && !sameDay(start, cell)) classes.push('has-head')
          return (
            <span key={cell.getDate()} className={classes.join(' ')}>
              <button
                type="button"
                aria-label={describe(cell)}
                aria-pressed={isStart || Boolean(end && sameDay(cell, end))}
                disabled={cell < today}
                onClick={() => choose(cell)}
                onPointerEnter={() => setHovered(cell)}
              >{cell.getDate()}</button>
            </span>
          )
        })}
      </div>
      <div className="range-calendar__foot">
        <p role="status" aria-live="polite">{status}</p>
        {start && <button type="button" className="event-text-button" onClick={() => onChange({ start: null, end: null })}>Clear</button>}
      </div>
    </div>
  )
}
