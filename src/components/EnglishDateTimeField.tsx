import { useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useDialogA11y } from '@/hooks/useDialogA11y'
import { parseLocalDateTime, toLocalDateTimeValue } from '@/utils/date-time'
import { Icon } from './Icon'
import './english-date-time.css'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const pad = (value: number) => String(value).padStart(2, '0')

interface Props {
  label: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

/** Native date pickers follow the browser's UI language, even on English pages. */
export function EnglishDateTimeField({ label, value, onChange, disabled = false }: Props) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const invalid = Boolean(value && !parseLocalDateTime(value))

  return <div className="english-date-time" lang="en">
    <label htmlFor={id}>{label}</label>
    <div className="english-date-time__control">
      <input id={id} type="text" value={value.replace('T', ' ')} disabled={disabled}
        placeholder="YYYY-MM-DD HH:mm" maxLength={16} autoComplete="off" spellCheck={false}
        aria-invalid={invalid} aria-describedby={`${id}-hint${invalid ? ` ${id}-error` : ''}`}
        onChange={event => onChange(event.target.value.replace(' ', 'T'))} />
      <button type="button" ref={buttonRef} disabled={disabled} onClick={() => setOpen(true)}
        aria-label={`Choose ${label.toLowerCase()} date and time`} aria-haspopup="dialog" aria-expanded={open}>
        <Icon name="CalendarDays" size={19} />
      </button>
    </div>
    <small id={`${id}-hint`}>YYYY-MM-DD HH:mm · 24-hour local time</small>
    {invalid && <small id={`${id}-error`} className="english-date-time__error">Enter a valid date and time, or use the date picker.</small>}
    {open && <DateTimePicker label={label} value={value} onChange={onChange} onClose={() => setOpen(false)} returnFocus={() => buttonRef.current} />}
  </div>
}

function DateTimePicker({ label, value, onChange, onClose, returnFocus }: Props & { onClose: () => void; returnFocus: () => HTMLElement | null }) {
  const [initial] = useState(() => parseLocalDateTime(value) ?? new Date())
  const [year, setYear] = useState(String(initial.getFullYear()))
  const [month, setMonth] = useState(initial.getMonth())
  const [day, setDay] = useState(initial.getDate())
  const [hour, setHour] = useState(initial.getHours())
  const [minute, setMinute] = useState(initial.getMinutes())
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useDialogA11y(dialogRef, onClose, { returnFocus })
  const yearValid = /^\d{4}$/.test(year) && Number(year) >= 1000
  const daysInMonth = new Date(yearValid ? Number(year) : initial.getFullYear(), month + 1, 0).getDate()
  const selectedDay = Math.min(day, daysInMonth)
  const selected = `${year}-${pad(month + 1)}-${pad(selectedDay)}T${pad(hour)}:${pad(minute)}`
  const date = parseLocalDateTime(selected)

  return createPortal(<div className="english-date-picker" lang="en">
    <div className="english-date-picker__scrim" onClick={onClose} />
    <div className="english-date-picker__dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <header><h2 id={titleId}>{label} date and time</h2><button type="button" onClick={onClose} aria-label="Close date picker"><Icon name="X" /></button></header>
      <p>Choose a date and a 24-hour time in your local time zone.</p>
      <div className="english-date-picker__date">
        <label>Month<select value={month} onChange={event => setMonth(Number(event.target.value))} data-dialog-initial>{MONTHS.map((name, index) => <option key={name} value={index}>{name}</option>)}</select></label>
        <label>Day<select value={selectedDay} onChange={event => setDay(Number(event.target.value))}>{Array.from({ length: daysInMonth }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></label>
        <label>Year<input type="text" inputMode="numeric" value={year} maxLength={4} aria-invalid={!yearValid} onChange={event => setYear(event.target.value)} /></label>
      </div>
      <div className="english-date-picker__time">
        <label>Hour<select value={hour} onChange={event => setHour(Number(event.target.value))}>{Array.from({ length: 24 }, (_, index) => <option key={index} value={index}>{pad(index)}</option>)}</select></label>
        <label>Minute<select value={minute} onChange={event => setMinute(Number(event.target.value))}>{Array.from({ length: 60 }, (_, index) => <option key={index} value={index}>{pad(index)}</option>)}</select></label>
      </div>
      {!yearValid && <p role="alert" className="english-date-time__error">Enter a four-digit year from 1000 to 9999.</p>}
      {yearValid && !date && <p role="alert" className="english-date-time__error">This local time is unavailable. Choose another time.</p>}
      <footer><button type="button" onClick={() => { onChange(''); onClose() }}>Clear</button><button type="button" className="english-date-picker__apply" disabled={!date} onClick={() => { if (date) { onChange(toLocalDateTimeValue(date)); onClose() } }}>Use date and time</button></footer>
    </div>
  </div>, document.body)
}
