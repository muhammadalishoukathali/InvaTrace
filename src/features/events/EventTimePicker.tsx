import { useEffect, useMemo, useState } from 'react'
import { Icon } from '@/components/Icon'
import { ENGLISH_LOCALE, parseLocalDateTime, toLocalDateTimeValue } from '@/utils/date-time'
import { formatEventDay, formatEventTime, formatEventWindow } from './event-format'
import {
  DEFAULT_DURATION_MINUTES, DURATION_CHOICES, MAX_DURATION_MINUTES, addMinutes, at, earliestStart, formatDuration,
  isDaySelectable, isHourSelectable, isStartSelectable, latestStart, minuteSlots, minutesBetween, sameDay, startForDay, startOfDay,
} from './event-time'

interface Props {
  startAt: string
  endAt: string
  onChange: (startAt: string, endAt: string) => void
  /** The event already started: only its length can change. */
  startFixed?: boolean
  disabled?: boolean
}

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
const monthTitle = new Intl.DateTimeFormat(ENGLISH_LOCALE, { month: 'long', year: 'numeric' })
const dayLabel = new Intl.DateTimeFormat(ENGLISH_LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const pad = (value: number) => String(value).padStart(2, '0')

function zoneLabel(date: Date) {
  return new Intl.DateTimeFormat(ENGLISH_LOCALE, { timeZoneName: 'short' }).formatToParts(date).find((part) => part.type === 'timeZoneName')?.value ?? 'local time'
}

/** Calendar date, hour and minute slots, then a duration — past slots are never offered. */
export function EventTimePicker({ startAt, endAt, onChange, startFixed = false, disabled = false }: Props) {
  const [now, setNow] = useState(() => new Date())
  // Keep the open slots honest while the form sits open.
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 30_000); return () => window.clearInterval(timer) }, [])

  const start = parseLocalDateTime(startAt)
  const end = parseLocalDateTime(endAt)
  const duration = start && end ? minutesBetween(start, end) : DEFAULT_DURATION_MINUTES
  const [pickedDay, setPickedDay] = useState<Date | null>(() => (start ? startOfDay(start) : null))
  const day = start ? startOfDay(start) : pickedDay
  const [view, setView] = useState(() => startOfDay(start ?? now))
  const viewMonth = new Date(view.getFullYear(), view.getMonth(), 1)
  const firstMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const lastMonth = (() => { const limit = latestStart(now); return new Date(limit.getFullYear(), limit.getMonth(), 1) })()

  const emit = (nextStart: Date | null, minutes = duration) => {
    if (!nextStart) { onChange('', ''); return }
    onChange(toLocalDateTimeValue(nextStart), toLocalDateTimeValue(addMinutes(nextStart, Math.min(minutes, MAX_DURATION_MINUTES))))
  }

  const cells = useMemo(() => {
    const leading = (viewMonth.getDay() + 6) % 7 // Monday-first weeks
    const days = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate()
    return [
      ...Array.from({ length: leading }, () => null),
      ...Array.from({ length: days }, (_, index) => new Date(viewMonth.getFullYear(), viewMonth.getMonth(), index + 1)),
    ]
  }, [viewMonth.getFullYear(), viewMonth.getMonth()]) // eslint-disable-line react-hooks/exhaustive-deps

  const durations = useMemo(() => {
    const list: number[] = [...DURATION_CHOICES]
    if (start && end && duration > 0 && duration <= MAX_DURATION_MINUTES && !list.includes(duration)) list.push(duration)
    return list.sort((a, b) => a - b)
  }, [start, end, duration])

  const chooseDay = (value: Date) => {
    setPickedDay(value)
    emit(startForDay(value, now, start))
  }
  const chooseHour = (hour: number) => {
    if (!day) return
    const minute = [start?.getMinutes() ?? 0, ...minuteSlots()].find((value) => isStartSelectable(at(day, hour, value), now))
    if (minute !== undefined) emit(at(day, hour, minute))
  }
  const chooseMinute = (minute: number) => { if (day && start) emit(at(day, start.getHours(), minute)) }

  if (startFixed && start) {
    return (
      <div className="event-time">
        <p className="event-time__fixed"><Icon name="Clock" size={16} /> Started at {formatEventTime(start.toISOString())} on {formatEventDay(start.toISOString())}. You can still change how long it runs.</p>
        <DurationChoices durations={durations} value={duration} disabled={disabled} isOpen={(minutes) => addMinutes(start, minutes) > now} onChoose={(minutes) => emit(start, minutes)} />
        <Summary start={start} end={end} duration={duration} />
      </div>
    )
  }

  return (
    <div className="event-time" lang="en">
      <fieldset className="event-time__block" disabled={disabled}>
        <legend>Date</legend>
        <div className="event-calendar">
          <div className="event-calendar__head">
            <button type="button" className="event-icon-button" aria-label="Previous month" disabled={viewMonth <= firstMonth} onClick={() => setView(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}><Icon name="ChevronLeft" size={18} /></button>
            <strong aria-live="polite">{monthTitle.format(viewMonth)}</strong>
            <button type="button" className="event-icon-button" aria-label="Next month" disabled={viewMonth >= lastMonth} onClick={() => setView(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}><Icon name="ChevronRight" size={18} /></button>
          </div>
          <div className="event-calendar__grid" role="group" aria-label={`Days in ${monthTitle.format(viewMonth)}`}>
            {WEEKDAYS.map((name) => <span key={name} className="event-calendar__weekday" aria-hidden>{name}</span>)}
            {cells.map((cell, index) => cell === null
              ? <span key={`blank-${index}`} aria-hidden />
              : (
                <button
                  key={cell.getDate()} type="button"
                  className={`event-calendar__day${sameDay(cell, now) ? ' is-today' : ''}`}
                  aria-label={`${dayLabel.format(cell)}${sameDay(cell, now) ? ' (today)' : ''}`}
                  aria-pressed={Boolean(day && sameDay(cell, day))}
                  disabled={!isDaySelectable(cell, now)}
                  onClick={() => chooseDay(cell)}
                >{cell.getDate()}</button>
              ))}
          </div>
        </div>
      </fieldset>

      <fieldset className="event-time__block" disabled={disabled || !day}>
        <legend>Start time <span className="event-muted">· {zoneLabel(start ?? now)}, 24-hour</span></legend>
        {!day && <p className="event-muted">Pick a date first.</p>}
        {day && (
          <>
            <div className="event-hours" role="group" aria-label="Hour">
              {Array.from({ length: 24 }, (_, hour) => (
                <button key={hour} type="button" aria-pressed={start?.getHours() === hour} disabled={!isHourSelectable(day, hour, now)} onClick={() => chooseHour(hour)}>{pad(hour)}</button>
              ))}
            </div>
            <div className="event-segmented event-time__minutes" role="group" aria-label="Minute">
              {minuteSlots().map((minute) => (
                <button key={minute} type="button" aria-pressed={start?.getMinutes() === minute} disabled={!start || !isStartSelectable(at(day, start.getHours(), minute), now)} onClick={() => chooseMinute(minute)}>:{pad(minute)}</button>
              ))}
            </div>
            {sameDay(day, now) && <p className="event-muted">Earliest start today is {pad(earliestStart(now).getHours())}:{pad(earliestStart(now).getMinutes())}.</p>}
          </>
        )}
      </fieldset>

      <fieldset className="event-time__block" disabled={disabled || !start}>
        <legend>How long</legend>
        <DurationChoices durations={durations} value={start ? duration : null} disabled={disabled || !start} isOpen={() => true} onChoose={(minutes) => emit(start, minutes)} />
      </fieldset>

      {start && <Summary start={start} end={end} duration={duration} />}
    </div>
  )
}

function DurationChoices({ durations, value, disabled, isOpen, onChoose }: { durations: number[]; value: number | null; disabled: boolean; isOpen: (minutes: number) => boolean; onChoose: (minutes: number) => void }) {
  return (
    <div className="event-segmented" role="group" aria-label="Duration">
      {durations.map((minutes) => (
        <button key={minutes} type="button" aria-pressed={value === minutes} disabled={disabled || !isOpen(minutes)} onClick={() => onChoose(minutes)}>{formatDuration(minutes)}</button>
      ))}
    </div>
  )
}

function Summary({ start, end, duration }: { start: Date; end: Date | null; duration: number }) {
  if (!end) return null
  return (
    <p className="event-time__summary" role="status">
      <Icon name="CalendarDays" size={16} />
      <span><strong>{formatEventWindow(start.toISOString(), end.toISOString())}</strong> · {formatDuration(duration)}</span>
    </p>
  )
}
