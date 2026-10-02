import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { ApiError } from '@/services/api-client'
import { submitFollowUp, type FollowUpLocation, type FollowUpOutcome } from '@/services/api/followUp'
import { OUTCOME_COPY } from './follow-up-copy'
import './follow-up.css'

const LOCATION_REJECTION_CODES = new Set([
  'follow_up_location_stale',
  'follow_up_accuracy_too_low',
  'follow_up_too_far',
  'follow_up_location_unavailable',
])

export function FollowUpConfirmPage({
  location,
  outcome,
  onLocationRejected,
  onStateChanged,
}: {
  location: FollowUpLocation
  outcome: FollowUpOutcome
  onLocationRejected: (code: string) => void
  onStateChanged: () => void
}) {
  const { sightingId } = useParams()
  const queryClient = useQueryClient()
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const submissionStarted = useRef(false)
  const copy = OUTCOME_COPY[outcome]
  const submit = async () => {
    if (submissionStarted.current) return
    submissionStarted.current = true
    setSubmitting(true)
    try {
      await submitFollowUp(sightingId!, location, outcome)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['sightings'] }),
        queryClient.invalidateQueries({ queryKey: ['sighting', sightingId] }),
      ])
      setDone(true)
    } catch (caught) {
      const code = caught instanceof ApiError ? caught.code ?? 'unknown' : 'unknown'
      if (code === 'follow_up_not_available') onStateChanged()
      else onLocationRejected(LOCATION_REJECTION_CODES.has(code) ? code : 'unknown')
    } finally {
      submissionStarted.current = false
      setSubmitting(false)
    }
  }
  if (done) return <main className="follow-up-page" aria-labelledby="follow-up-done-title"><section className="follow-up-panel follow-up-panel--success" role="status"><h1 id="follow-up-done-title">Follow-up recorded</h1><p>{copy.completed}</p><p className="follow-up-explainer">This records a community observation. It does not independently verify removal or treatment.</p><Link className="follow-up-button" to="/map">Return to map</Link></section></main>
  return <main className="follow-up-page" aria-labelledby="follow-up-confirm-title"><section className="follow-up-panel"><h1 id="follow-up-confirm-title">{copy.label}</h1><p>{copy.description}</p><aside className="follow-up-preview"><strong>How the marker will change</strong><p>{copy.next}</p></aside><button type="button" className="follow-up-button" disabled={submitting} onClick={submit}>{submitting ? 'Recording follow-up…' : 'Record follow-up'}</button></section></main>
}
