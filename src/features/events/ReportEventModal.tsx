import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation } from '@tanstack/react-query'
import { useDialogA11y } from '@/hooks/useDialogA11y'
import { eventsApi } from '@/services/api/events'

export function ReportEventModal({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const [reason, setReason] = useState('')
  const dialog = useRef<HTMLDivElement>(null)
  const flag = useMutation({ mutationFn: () => eventsApi.flag(eventId, reason.trim()), onSuccess: onClose })
  useDialogA11y(dialog, onClose)
  return createPortal(<div className="event-dialog">
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="flag-title">
      <h2 id="flag-title">Report this event</h2>
      <label>What is the concern?<textarea data-dialog-initial maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label>
      {flag.error && <p role="alert">The report could not be sent. Try again.</p>}
      <footer><button onClick={onClose}>Cancel</button><button className="event-primary" disabled={reason.trim().length < 3 || flag.isPending} onClick={() => flag.mutate()}>{flag.isPending ? 'Sending…' : 'Send report'}</button></footer>
    </div>
  </div>, document.body)
}
