import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation } from '@tanstack/react-query'
import { Icon } from '@/components/Icon'
import { useDialogA11y } from '@/hooks/useDialogA11y'
import { eventsApi } from '@/services/api/events'

const REASONS = [
  'Encourages unsafe or unpermitted removal',
  'Wrong place, time or details',
  'Spam or not about invasive plants',
  'Harmful or abusive content',
]

/** AC 9.7.3: anyone can flag a concerning event; three distinct flags hide it. */
export function ReportEventModal({ eventId, onClose, onSent }: { eventId: string; onClose: () => void; onSent: () => void }) {
  const [choice, setChoice] = useState('')
  const [details, setDetails] = useState('')
  const dialog = useRef<HTMLDivElement>(null)
  const reason = [choice, details.trim()].filter(Boolean).join(' — ')
  const flag = useMutation({ mutationFn: () => eventsApi.flag(eventId, reason), onSuccess: onSent })
  useDialogA11y(dialog, onClose)
  return createPortal(
    <div className="event-sheet">
      <div className="event-sheet__scrim" onClick={onClose} />
      <div ref={dialog} className="event-sheet__panel" role="dialog" aria-modal="true" aria-labelledby="flag-title" tabIndex={-1}>
        <header className="event-sheet__header">
          <h2 id="flag-title">Report this event</h2>
          <button type="button" className="event-icon-button" onClick={onClose} aria-label="Close"><Icon name="X" size={20} /></button>
        </header>
        <div className="event-sheet__body">
          <fieldset className="event-choice-list">
            <legend>What is the concern?</legend>
            {REASONS.map((item, index) => (
              <label key={item}>
                <input type="radio" name="flag-reason" value={item} checked={choice === item} onChange={() => setChoice(item)} {...(index === 0 ? { 'data-dialog-initial': true } : {})} />
                <span>{item}</span>
              </label>
            ))}
          </fieldset>
          <label className="event-field">
            <span>Details (optional)</span>
            <textarea maxLength={400} rows={3} value={details} onChange={(event) => setDetails(event.target.value)} />
          </label>
          <p className="event-muted">Reports are anonymous. An event is hidden for review after several different people report it.</p>
          {flag.error && <p className="event-inline-alert" role="alert">The report could not be sent. Try again.</p>}
        </div>
        <footer className="event-sheet__footer">
          <button type="button" className="event-button" onClick={onClose}>Cancel</button>
          <button type="button" className="event-button event-button--primary" disabled={reason.length < 3 || flag.isPending} onClick={() => flag.mutate()}>
            {flag.isPending ? 'Sending…' : 'Send report'}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
