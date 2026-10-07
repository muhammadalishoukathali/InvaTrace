import { useState } from 'react'
import { Icon } from '@/components/Icon'
import { useReportDraft } from '@/features/report/report-draft-store'
import { submitReport } from '@/features/report/report-queue'
import { ReportNextButton } from './components/ReportNextButton'
import { LOCATION_ACCURACY_MAX_M } from './gps-policy'
import { useEventContext } from '@/features/events/event-context'
import { ApiError } from '@/services/api-client'
import { useLocation } from 'react-router-dom'
import { missionIdForScan } from '@/features/guided-missions/mission-context'
import { scanReturnPath } from '@/features/scan/scan-navigation'
import { usePrivateAccess } from '@/features/private-access/private-access-store'
import { findApprovedSpecies } from '@shared/catalogue'

const EVENT_REJECTION_MESSAGES: Record<string, string> = {
  event_report_already_linked: 'This photo already belongs to an earlier report. View the original in My Records.',
  event_not_taggable: 'This event is no longer accepting reports.',
  checkin_required: 'Check in at this event before submitting an event report.',
  captured_at_required: 'This scan has no capture time for an event report.',
  captured_at_outside_event: 'This scan was captured outside the event time window.',
  upload_grace_exceeded: 'The event’s 24-hour upload period has ended.',
  event_budget_exceeded: 'You have reached this event’s report limit.',
  outside_place: 'This scan’s location is outside the event place.',
  place_geometry_changed: 'The event’s place boundary has changed. Check in again.',
  event_geometry_stale: 'The event’s place boundary has changed. Contact the host before checking in again.',
}

const EXTENT_LABEL = {
  single: 'Single plant',
  small_patch: 'Small patch',
  large_area: 'Large area',
} as const

/**
 * Step 4 of 4 in the report wizard (location, extent, consent, preview) -
 * the last screen before it actually goes out. Hitting submit calls
 * submitReport(), which either finishes right away or, if we're offline or
 * the request fails, falls back to saving it in the local queue instead.
 * Either way we don't handle that difference here - we just store whatever
 * outcome comes back so ReportSubmissionResult.tsx can decide what to show.
 */
export function ReportPreviewStep() {
  const activeEvent = useEventContext()
  const location = useLocation()
  const profileId = usePrivateAccess((state) => state.profile?.id)
  // Epic 7: reports from a guided-mission scan are linked to that mission.
  const missionId = missionIdForScan(scanReturnPath(location.state), profileId)
  const [eventRejected, setEventRejected] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const {
    draft, imageBlob, imageUrl, submitting,
    setSubmitting, setOutcome, toSubmission,
  } = useReportDraft()
  if (!draft) return null

  const captureTime = draft ? Date.parse(draft.observedAt) : NaN
  const eventEligible = !!activeEvent
    && captureTime >= Date.parse(activeEvent.startAt)
    && captureTime <= Date.parse(activeEvent.endAt)
    && Date.now() <= Date.parse(activeEvent.endAt) + 24 * 60 * 60 * 1000

  const submit = async (toEvent = false) => {
    const submission = toSubmission()
    if (!submission || !imageBlob) return

    setSubmitting(true)
    setSubmitError(null)
    try {
      const tagged = missionId ? { ...submission, missionId } : submission
      const result = await submitReport(toEvent && activeEvent
        ? { ...tagged, eventId: activeEvent.eventId, capturedAt: draft.observedAt }
        : tagged, imageBlob)
      if (result.status === 'submitted' && result.report) {
        setOutcome({ kind: 'submitted', report: result.report })
      } else {
        setOutcome({
          kind: 'queued',
          queuedId: result.queuedId ?? 'unknown',
          error: result.error ?? 'Unknown error',
        })
      }
    } catch (error) {
      if (toEvent && error instanceof ApiError && error.code !== null && Object.hasOwn(EVENT_REJECTION_MESSAGES, error.code)) {
        setEventRejected(true)

        setSubmitError(`${EVENT_REJECTION_MESSAGES[error.code ?? ''] ?? error.message} Your scan is kept. You can submit it as an ordinary report.`)
        return
      }
      setSubmitError(error instanceof Error ? error.message : 'The report could not be submitted.')
    } finally {
      setSubmitting(false)
    }
  }

  // Same rule as the location step: accuracy is only a soft warning there,
  // not something we block on, so we keep that consistent here too - just
  // check it's a real non-negative number and leave it at that. We're not
  // going to second-guess a fix the user already accepted earlier.
  const hasFiniteAccuracy = draft.locationAccuracyM !== null
    && Number.isFinite(draft.locationAccuracyM)
    && draft.locationAccuracyM >= 0
  const canSubmit = !!draft.location
    && hasFiniteAccuracy
    && !!draft.extent
    && !!imageBlob
    && draft.consentAccurate
    && draft.consentNoPII

  return (
    <div style={{ padding: 16, maxWidth: 520, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {imageUrl && (
        <img src={imageUrl} alt="Report photo" style={{
          width: '100%', maxHeight: 220, objectFit: 'cover',
          borderRadius: 'var(--r-card)', display: 'block',
        }} />
      )}

      <Card>
        <Row icon="Leaf"
             label="Species"
             value={draft.speciesId
               ? (findApprovedSpecies({ speciesId: draft.speciesId })?.common_names[0] ?? draft.speciesId)
               : 'Unknown - automated screening will request a rescan if needed'} />
        <Divider />
        <Row icon="AlertTriangle"
             label="Outcome"
             value={`${draft.outcome.replace('_', ' ')} · ${Math.round(draft.confidence * 100)}% confidence`} />
        <Divider />
        <Row icon="MapPin"
             label="Location"
             value={draft.location
               ? `${draft.location.lat.toFixed(5)}, ${draft.location.lng.toFixed(5)}`
               : '-'}
             sub={draft.locationAccuracyM != null ? `±${draft.locationAccuracyM} m GPS` : 'Accuracy unavailable'}
             mono />
        <Divider />
        <Row icon="Grid3x3"
             label="Extent"
             value={draft.extent ? EXTENT_LABEL[draft.extent] : '-'} />
        {draft.notes && (
          <>
            <Divider />
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px 0' }}>
              <Icon name="Info" size={18} color="var(--icon)" />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Notes
                </div>
                <div style={{ fontSize: 13.5, color: 'var(--ink)', marginTop: 4, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                  {draft.notes}
                </div>
              </div>
            </div>
          </>
        )}
      </Card>

      <p style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.55, marginTop: 4 }}>
        InvaTrace model {draft.modelVersion}
      </p>

      {draft.locationAccuracyM != null && draft.locationAccuracyM > LOCATION_ACCURACY_MAX_M && (
        <p role="note" style={{
          margin: 0, padding: '10px 12px', borderRadius: 'var(--r-card)',
          border: '1px solid var(--border)', background: 'var(--hover)',
          color: 'var(--amber-text)', fontSize: 13, lineHeight: 1.5,
        }}>
          GPS accuracy is ±{draft.locationAccuracyM} m. Reports above {LOCATION_ACCURACY_MAX_M} m are sent back for a rescan - go back to Location and re-locate outdoors first.
        </p>
      )}

      {missionId && <p role="note" style={{ margin: 0, fontSize: 13, color: 'var(--body)', lineHeight: 1.5 }}>This report will appear in your guided mission progress. It is still an ordinary community report.</p>}
      {eventEligible && <p>Community-reported event evidence. Joining an event does not grant removal permission.</p>}
      <ReportNextButton
        disabled={!canSubmit}
        loading={submitting}
        onClick={() => submit(eventEligible && !eventRejected)}
        label={submitting ? 'Submitting…' : eventEligible && !eventRejected ? 'Submit to this event' : eventRejected ? 'Submit as ordinary report' : 'Submit report'}
        variant="submit"
      />
      {eventEligible && !eventRejected && <button type="button" disabled={!canSubmit || submitting} onClick={() => submit(false)} style={{ minHeight: 44, padding: '10px 14px', border: '1px solid var(--control-border)', borderRadius: 'var(--r-button)', background: 'var(--surface)', cursor: 'pointer' }}>Submit as ordinary report</button>}
      {submitError && <p role="alert" style={{ color: 'var(--red-text)', fontSize: 13 }}>{submitError}</p>}
    </div>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--r-card)', padding: '4px 16px',
    }}>
      {children}
    </div>
  )
}

function Divider() {
  return <div style={{ height: 1, background: 'var(--border)' }} />
}

function Row({ icon, label, value, sub, mono }: {
  icon: string; label: string; value: string; sub?: string; mono?: boolean
}) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px 0' }}>
      <Icon name={icon} size={18} color="var(--icon)" />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {label}
        </div>
        <div className={mono ? 'mono' : undefined}
             style={{ fontSize: 14, color: 'var(--ink)', marginTop: 3, fontWeight: 500, textTransform: mono ? 'none' : 'capitalize' }}>
          {value}
        </div>
        {sub && <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>}
      </div>
    </div>
  )
}
