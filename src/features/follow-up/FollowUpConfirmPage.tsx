import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { BackLink } from '@/components/BackLink'
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
  if (done) {
    return (
      <section className="follow-up-page" aria-labelledby="follow-up-done-title">
        <section className="follow-up-panel follow-up-panel--success" role="status">
          <p className="follow-up-kicker">Follow-up saved</p>
          <h2 id="follow-up-done-title">Follow-up recorded</h2>
          <aside className="follow-up-preview"><strong>What changed on the map</strong><p>{copy.completed}</p></aside>
          <p className="follow-up-explainer">This records a community observation. It does not independently verify removal or treatment. The original report and its history are kept.</p>
          <div className="follow-up-actions">
            <Link className="follow-up-button follow-up-button--secondary" to={`/map?sighting=${encodeURIComponent(sightingId ?? '')}`}>View sighting history</Link>
            <Link className="follow-up-button" to="/map">Return to map</Link>
          </div>
        </section>
      </section>
    )
  }
  return (
    <section className="follow-up-page" aria-labelledby="follow-up-confirm-title">
      <BackLink to={`/sightings/${sightingId}/follow-up/outcome`}>Back to outcome</BackLink>
      <section className="follow-up-panel">
        <p className="follow-up-kicker">Step 3 of 3 · Confirm</p>
        <h2 id="follow-up-confirm-title">{copy.label}</h2>
        <p>{copy.description}</p>
        <aside className="follow-up-preview"><strong>How the marker will change</strong><p>{copy.next}</p></aside>
        <p className="follow-up-explainer">Recorded at ±{Math.round(location.accuracyM)} m accuracy. Submitting saves this as a community observation.</p>
        <button type="button" className="follow-up-button" disabled={submitting} onClick={submit}>{submitting ? 'Recording follow-up…' : 'Record follow-up'}</button>
      </section>
    </section>
  )
}
