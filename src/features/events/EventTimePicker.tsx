import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Icon } from '@/components/Icon'
import { useDialogA11y } from '@/hooks/useDialogA11y'
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
const dayShort = new Intl.DateTimeFormat(ENGLISH_LOCALE, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
const pad = (value: number) => String(value).padStart(2, '0')

function zoneLabel(date: Date) {
  return new Intl.DateTimeFormat(ENGLISH_LOCALE, { timeZoneName: 'short' }).formatToParts(date).find((part) => part.type === 'timeZoneName')?.value ?? 'local time'
}

/** Date, start time and length as three drop-down fields — past slots are never offered. */
export function EventTimePicker({ startAt, endAt, onChange, startFixed = false, disabled = false }: Props) {
  const [now, setNow] = useState(() => new Date())
  // Keep the open slots honest while the form sits open.
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 30_000); return () => window.clearInterval(timer) }, [])

  const start = parseLocalDateTime(startAt)
  const end = parseLocalDateTime(endAt)
  const duration = start && end ? minutesBetween(start, end) : DEFAULT_DURATION_MINUTES
  const day = start ? startOfDay(start) : null
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

  const chooseHour = (hour: number) => {
    if (!day) return
    const minute = [start?.getMinutes() ?? 0, ...minuteSlots()].find((value) => isStartSelectable(at(day, hour, value), now))
    if (minute !== undefined) emit(at(day, hour, minute))
  }

  const durationField = (isOpen: (minutes: number) => boolean) => (
    <Dropdown label="How long" icon="Clock" value={start ? formatDuration(duration) : null} placeholder="Choose length" disabled={disabled || !start}>
      {(close) => (
        <ul className="event-dropdown__list" aria-label="Duration">
          {durations.map((minutes) => (
            <li key={minutes}>
              <button type="button" aria-pressed={duration === minutes} disabled={!isOpen(minutes)} onClick={() => { emit(start, minutes); close() }}>
                <span>{formatDuration(minutes)}</span>
                {start && <small>until {formatEventTime(addMinutes(start, minutes).toISOString())}{sameDay(start, addMinutes(start, minutes)) ? '' : ' next day'}</small>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dropdown>
  )

  if (startFixed && start) {
    return (
      <div className="event-time">
        <p className="event-time__fixed"><Icon name="Clock" size={16} /> Started at {formatEventTime(start.toISOString())} on {formatEventDay(start.toISOString())}. You can still change how long it runs.</p>
        <div className="event-time__fields">{durationField((minutes) => addMinutes(start, minutes) > now)}</div>
        <Summary start={start} end={end} duration={duration} />
      </div>
    )
  }

  return (
    <div className="event-time" lang="en">
      <div className="event-time__fields">
        <Dropdown label="Date" icon="CalendarDays" value={day ? dayShort.format(day) : null} placeholder="Choose a date" disabled={disabled}>
          {(close) => (
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
                      onClick={() => { emit(startForDay(cell, now, start)); close() }}
                    >{cell.getDate()}</button>
                  ))}
              </div>
            </div>
          )}
        </Dropdown>

        <Dropdown label="Start time" icon="Clock" value={start ? `${pad(start.getHours())}:${pad(start.getMinutes())}` : null} placeholder={day ? 'Choose a time' : 'Pick a date first'} disabled={disabled || !day}>
          {(close) => day && (
            <div className="event-time__panel">
              <p className="event-muted">{zoneLabel(start ?? now)}, 24-hour{sameDay(day, now) ? ` · earliest today ${pad(earliestStart(now).getHours())}:${pad(earliestStart(now).getMinutes())}` : ''}</p>
              <div className="event-hours" role="group" aria-label="Hour">
                {Array.from({ length: 24 }, (_, hour) => (
                  <button key={hour} type="button" aria-pressed={start?.getHours() === hour} disabled={!isHourSelectable(day, hour, now)} onClick={() => chooseHour(hour)}>{pad(hour)}</button>
                ))}
              </div>
              <div className="event-segmented event-time__minutes" role="group" aria-label="Minute">
                {minuteSlots().map((minute) => (
                  <button key={minute} type="button" aria-pressed={start?.getMinutes() === minute} disabled={!start || !isStartSelectable(at(day, start.getHours(), minute), now)} onClick={() => { if (start) emit(at(day, start.getHours(), minute)); close() }}>:{pad(minute)}</button>
                ))}
              </div>
              <button type="button" className="event-button event-button--primary event-button--block" onClick={close}>Done</button>
            </div>
          )}
        </Dropdown>

        {durationField(() => true)}
      </div>
      {start && <Summary start={start} end={end} duration={duration} />}
    </div>
  )
}

interface DropdownProps {
  label: string
  icon: 'CalendarDays' | 'Clock'
  value: string | null
  placeholder: string
  disabled?: boolean
  children: (close: () => void) => ReactNode
}

/** A field that drops a panel below it; on phones the panel becomes a bottom sheet. */
function Dropdown({ label, icon, value, placeholder, disabled = false, children }: DropdownProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const labelId = useId()
  const close = () => setOpen(false)
  useDialogA11y(panelRef, close, { active: open, returnFocus: () => triggerRef.current })

  return (
    <div className={`event-dropdown${open ? ' is-open' : ''}`}>
      <span id={labelId} className="event-dropdown__label">{label}</span>
      <button
        ref={triggerRef} type="button" className="event-dropdown__trigger" disabled={disabled}
        aria-haspopup="dialog" aria-expanded={open} aria-labelledby={`${labelId} ${labelId}-value`}
        onClick={() => setOpen((previous) => !previous)}
      >
        <Icon name={icon} size={17} />
        <span id={`${labelId}-value`} className={value ? '' : 'is-placeholder'}>{value ?? placeholder}</span>
        <Icon name="ChevronDown" size={16} />
      </button>
      {open && (
        <>
          <div className="event-dropdown__scrim" onClick={close} aria-hidden />
          <div ref={panelRef} className="event-dropdown__panel" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
            <header className="event-dropdown__head">
              <strong>{label}</strong>
              <button type="button" className="event-icon-button" aria-label={`Close ${label.toLowerCase()}`} onClick={close}><Icon name="X" size={18} /></button>
            </header>
            {children(close)}
          </div>
        </>
      )}
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
