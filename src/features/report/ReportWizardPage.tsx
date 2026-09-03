import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { useReportDraft, REPORT_STEPS } from '@/features/report/report-draft-store'
import { useScan } from '@/features/scan/scan-store'
import { ReportLocationStep } from './ReportLocationStep'
import { ReportExtentStep } from './ReportExtentStep'
import { ReportConsentStep } from './ReportConsentStep'
import { ReportPreviewStep } from './ReportPreviewStep'
import { ReportSubmissionResult } from './ReportSubmissionResult'

const STEP_LABEL: Record<string, string> = {
  location: 'Location',
  extent: 'Extent',
  consent: 'Consent',
  preview: 'Preview',
}

/**
 * This is the entry point for the whole report feature. It just renders
 * whatever the current step is from report-draft-store.ts (location, then
 * extent, then consent, then preview) under one shared header, back button
 * and progress bar, and swaps over to ReportSubmissionResult.tsx once the
 * draft has an outcome. If there's no draft and no outcome at all, we
 * redirect back to /scan - this page only really makes sense right after a
 * scan has seeded a draft through beginFromScan(), there's no other way in.
 */
export function ReportWizardPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { step, draft, outcome, back, reset } = useReportDraft()

  useEffect(() => {
    if (!draft && !outcome) navigate('/scan', { replace: true, state: location.state })
  }, [draft, outcome, location.state, navigate])

  if (!draft && !outcome) return null

  if (outcome) return <ReportSubmissionResult />

  const stepIndex = REPORT_STEPS.indexOf(step)
  const isFirst = stepIndex === 0

  const handleBack = () => {
    if (isFirst) {
      // We only send the user back to the scan result page if that scan is
      // still in memory. If it's not, /scan/result would just redirect them
      // straight to /scan and they'd land on a blank camera, which is
      // confusing. So we fall back to the map instead, at least that's
      // somewhere useful.
      const hasScan = !!useScan.getState().result
      reset()
      navigate(hasScan ? '/scan/result' : '/map', { state: location.state })
    } else {
      back()
    }
  }

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      <header style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '12px 12px',
        paddingTop: 'calc(12px + env(safe-area-inset-top))',
        background: 'var(--surface)', borderBottom: '1px solid var(--border)',
        position: 'sticky', top: 0, zIndex: 5,
      }}>
        <button type="button" onClick={handleBack} aria-label="Back" style={{
          width: 44, height: 44, borderRadius: '50%', border: 'none',
          background: 'transparent', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name="ChevronLeft" size={22} color="var(--ink)" />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>Report a sighting</h1>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            Step {stepIndex + 1} of {REPORT_STEPS.length} · {STEP_LABEL[step]}
          </div>
        </div>
      </header>

      <div role="progressbar" aria-label={`Report progress: step ${stepIndex + 1} of ${REPORT_STEPS.length}`}
        aria-valuemin={1} aria-valuemax={REPORT_STEPS.length} aria-valuenow={stepIndex + 1}
        style={{ display: 'flex', gap: 4, padding: '8px 16px', background: 'var(--surface)' }}>
        {REPORT_STEPS.map((s, i) => (
          <div key={s} aria-hidden style={{
            flex: 1, height: 3, borderRadius: 2,
            background: i <= stepIndex ? 'var(--green)' : 'var(--border)',
            transition: 'background 0.2s ease',
          }} />
        ))}
      </div>

      <main style={{ flex: 1, overflowY: 'auto', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {step === 'location' && <ReportLocationStep />}
        {step === 'extent' && <ReportExtentStep />}
        {step === 'consent' && <ReportConsentStep />}
        {step === 'preview' && <ReportPreviewStep />}
      </main>
    </div>
  )
}
