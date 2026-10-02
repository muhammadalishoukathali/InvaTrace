import 'fake-indexeddb/auto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { submitReport, listQueuedReports, flushQueue, canSubmitQueuedAsOrdinary, submitQueuedAsOrdinary } from './report-queue'
import { usePrivateAccess } from '@/features/private-access/private-access-store'
import { ApiError } from '@/services/api-client'

const server = setupServer()
beforeAll(() => { vi.stubGlobal('navigator', { onLine: true }); server.listen({ onUnhandledRequest: 'error' }) })
afterAll(() => { server.close(); vi.unstubAllGlobals() })
beforeEach(() => {
  server.resetHandlers()
  usePrivateAccess.setState({ profile: { id: 'event-reporter', displayName: null, role: 'Detector', trustLevel: 'New' } })
})
const submission = () => ({ eventId: 'event-1', capturedAt: new Date().toISOString(),
  speciesId: 'mikania-micrantha', outcome: 'target' as const, confidence: .9, modelVersion: 'test',
  observedAt: new Date().toISOString(), captureId: crypto.randomUUID(), captureSource: 'camera' as const,
  location: { lat: 3.14, lng: 101.69 }, locationAccuracyM: 10, extent: 'single' as const,
  notes: '', consent: { accurate: true as const, noPII: true as const } })
function uploads() {
  server.use(http.post('http://localhost/api/v1/uploads/presign', () => HttpResponse.json({
    photoKey: 'uploads/event.jpg', uploadUrl: 'http://localhost/upload-event', uploadId: 'upload', expiresAt: new Date().toISOString(),
  })), http.put('http://localhost/upload-event', () => new HttpResponse(null, { status: 200 })))
}
describe('event report recovery', () => {
  it.each(['event_not_taggable', 'checkin_required', 'captured_at_required', 'upload_grace_exceeded', 'event_budget_exceeded', 'event_report_already_linked'])(
    'does not queue a rejected %s report for endless automatic retries', async (code) => {
      uploads()
      server.use(http.post('http://localhost/api/v1/reports', () => HttpResponse.json({ code, detail: 'Event report rejected' }, { status: code === 'event_budget_exceeded' ? 429 : 422 })))
      const draft = submission(); const blob = new Blob(['saved photo'], { type: 'image/jpeg' })
      await expect(submitReport(draft, blob)).rejects.toBeInstanceOf(ApiError)
      expect((await listQueuedReports()).some(item => item.submission.captureId === draft.captureId)).toBe(false)
      expect(draft.eventId).toBe('event-1')
      expect(await blob.text()).toBe('saved photo')
    },
  )
  it('keeps event identity and authoritative capture time in an offline retry', async () => {
    uploads()
    server.use(http.post('http://localhost/api/v1/reports', () => HttpResponse.json({ code: 'temporary', detail: 'Try later' }, { status: 503 })))
    const draft = submission()
    const result = await submitReport(draft, new Blob(['offline photo'], { type: 'image/jpeg' }))
    expect(result.status).toBe('queued')
    const item = (await listQueuedReports()).find(item => item.id === result.queuedId)
    expect(item?.submission.eventId).toBe(draft.eventId)
    expect(item?.submission.capturedAt).toBe(draft.capturedAt)
    expect(await item?.imageBlob.text()).toBe('offline photo')
  })
  it('keeps a late offline rejection and submits ordinary only after explicit recovery', async () => {
    uploads()
    let phase = 'offline'
    let ordinary: Record<string, unknown> | null = null
    server.use(http.post('http://localhost/api/v1/scans', () => HttpResponse.json({})))
    server.use(http.post('http://localhost/api/v1/reports', async ({ request }) => {
      const body = await request.json() as Record<string, unknown>
      if (phase === 'offline') return HttpResponse.json({ code: 'temporary', detail: 'Try later' }, { status: 503 })
      if (body.eventId) return HttpResponse.json({ code: 'upload_grace_exceeded', detail: 'The event upload period ended.' }, { status: 422 })
      ordinary = body
      return HttpResponse.json({ id: 'ordinary-recovery' }, { status: 201 })
    }))
    const draft = submission()
    const result = await submitReport(draft, new Blob(['saved offline photo'], { type: 'image/jpeg' }))
    phase = 'online'
    await flushQueue()
    const kept = (await listQueuedReports()).find(item => item.id === result.queuedId)!
    expect(kept.retryable).toBe(false)
    expect(kept.lastErrorCode).toBe('upload_grace_exceeded')
    expect(canSubmitQueuedAsOrdinary(kept)).toBe(true)
    expect(await kept.imageBlob.text()).toBe('saved offline photo')
    expect(ordinary).toBeNull()
    await submitQueuedAsOrdinary(kept.id)
    expect(ordinary).toMatchObject({ captureId: draft.captureId, location: draft.location, consent: draft.consent })
    expect(ordinary).not.toHaveProperty('eventId')
    expect(ordinary).not.toHaveProperty('capturedAt')
    expect((await listQueuedReports()).some(item => item.id === kept.id)).toBe(false)
  })
  it('does not recover another identity’s queued report or a photo already linked elsewhere', async () => {
    const item = { submission: { ...submission(), photoKey: 'photo' }, retryable: false, lastErrorCode: 'event_report_already_linked' }
    expect(canSubmitQueuedAsOrdinary(item as Parameters<typeof canSubmitQueuedAsOrdinary>[0])).toBe(false)
    await expect(submitQueuedAsOrdinary('not-owned')).rejects.toThrow('cannot be recovered')
  })

})
