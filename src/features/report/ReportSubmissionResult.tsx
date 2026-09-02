import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useReportDraft } from '@/features/report/report-draft-store'
import { useScan } from '@/features/scan/scan-store'
import { api } from '@/services/api-client'
import type { Report } from '@/types'
import './report-submission-result.css'

/**
 * Terminal screen of the report wizard, shown once ReportPreviewStep.tsx
 * sets an outcome — either "submitted" (sent to the server, now screening)
 * or "queued" (saved offline, will retry via report-queue.ts). Not one of
 * the numbered REPORT_STEPS since it isn't a form step, just the exit.
 */
export function ReportSubmissionResult() {
  const navigate = useNavigate()
  const { outcome, reset } = useReportDraft()

  const done = (destination: string) => {
    // Server-supplied absolute URLs would otherwise be interpreted as SPA
    // routes and 404. Open externally and stay put so the reset still runs.
    if (/^https?:\/\//i.test(destination)) {
      window.open(destination, '_blank', 'noopener,noreferrer')
    } else {
      navigate(destination, { replace: true })
    }
    window.setTimeout(() => {
      reset()
      useScan.getState().reset()
    }, 150)
  }

  // AC 4.1.4 — a submission returns `processing` initially; poll the report
  // until it becomes `screened` (published) so this screen can honestly move
  // from "submitted" to the required "Report published" wording. `rejected`
  // and `needs_rescan` surface their own honest states rather than pretending
  // to publish.
  const initialReport = outcome?.kind === 'submitted' ? outcome.report : null
  const [status, setStatus] = useState<Report['status'] | null>(initialReport?.status ?? null)
  const [sightingId, setSightingId] = useState<string | null>(initialReport?.sightingId ?? null)
  const reportId = initialReport?.id ?? null
  useEffect(() => {
    if (!reportId) return
    if (status && status !== 'processing') return
    let cancelled = false
    const poll = async () => {
      try {
        const latest = await api<Report>(`/api/v1/reports/${reportId}`)
        if (cancelled) return
        setStatus(latest.status)
        setSightingId(latest.sightingId ?? null)
      } catch {
        // Network blip — keep the pending wording; the next tick retries.
      }
    }
    void poll()
    const handle = window.setInterval(poll, 2000)
    return () => { cancelled = true; window.clearInterval(handle) }
  }, [reportId, status])

  if (!outcome) return null

  const submitted = outcome.kind === 'submitted'
  const trackingDestination = submitted && outcome.kind === 'submitted'
    ? (typeof outcome.report.trackingUrl === 'string' && outcome.report.trackingUrl.length > 0
      ? outcome.report.trackingUrl
      : `/reports/${outcome.report.id}`)
    : null

  if (submitted && status === 'screened') {
    return (
      <main className="report-submission-result">
        <section className="report-submission-result__body" aria-live="polite">
          <h1>Report published</h1>
          <p>Community report - not expert validated</p>
          <div className="report-submission-result__actions">
            <button type="button" onClick={() => done(sightingId ? `/map?sighting=${sightingId}` : '/map')}>
              View on map
            </button>
          </div>
        </section>
      </main>
    )
  }

  if (submitted && status === 'needs_rescan') {
    return (
      <main className="report-submission-result">
        <section className="report-submission-result__body" aria-live="polite">
          <h1>A new scan is needed</h1>
          <p>Automated screening could not accept this evidence. Capture a fresh photo and try again.</p>
          <div className="report-submission-result__actions">
            <button type="button" onClick={() => done('/scan')}>Scan again</button>
          </div>
        </section>
      </main>
    )
  }

  if (submitted && status === 'rejected') {
    return (
      <main className="report-submission-result">
        <section className="report-submission-result__body" aria-live="polite">
          <h1>Report not published</h1>
          <p>Automated duplicate or safety checks rejected this evidence.</p>
          <div className="report-submission-result__actions">
            {trackingDestination && (
              <button type="button" onClick={() => done(trackingDestination)}>View report</button>
            )}
            <button type="button" className="report-submission-result__secondary" onClick={() => done('/map')}>Back to map</button>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="report-submission-result">
      <section className="report-submission-result__body" aria-live="polite">
        <h1>{submitted ? 'Report submitted' : 'Saved for later'}</h1>

        {submitted ? (
          <p>
            We’re checking the photo, location and submission details. You can follow the report’s status from My records.
          </p>
        ) : (
          <p>The report is stored on this device and will retry when a connection is available.</p>
        )}

        <div className="report-submission-result__actions">
          {trackingDestination && (
            <button type="button" onClick={() => done(trackingDestination)}>
              View report
            </button>
          )}
          <button type="button" className="report-submission-result__secondary" onClick={() => done('/map')}>
            Back to map
          </button>
        </div>
      </section>
    </main>
  )
}
