// Loaded explicitly by the responsive browser suite; never by application code.
import { http, HttpResponse } from 'msw'
import { worker } from '../../src/mocks/browser'
import type { Report, ReportStatus } from '../../src/types'

export const fixture = { error: false, empty: false, status: 'screened' as ReportStatus }
const now = new Date().toISOString()
export const report: Report = {
  id: 'layout-report', status: 'screened', createdAt: now, retainedReportId: null,
  trackingUrl: '/reports/layout-report', sightingId: 's-1',
  submission: {
    photoKey: 'layout-photo', speciesId: 'mikania-micrantha', outcome: 'target',
    confidence: 0.92, modelVersion: 'invatrace-student33-tinyvit5m-320-fp16',
    observedAt: now, captureId: 'layout-capture', captureSource: 'gallery',
    location: { lat: 3.1497, lng: 101.6412 }, locationAccuracyM: 8,
    extent: 'single', notes: 'Beside the marked trail.', consent: { accurate: true, noPII: true },
  },
  validation: { reasonCodes: [], retryable: false, policyVersion: 'layout-test', screeningMethod: 'deterministic_rules' },
}
const event = {
  event_id: 'layout-event', title: 'Community monitoring at Bukit Kiara',
  purpose: 'Record and revisit invasive plants along the marked trail.', event_type: 'survey',
  status: 'published', place_id: '10000000-0000-4000-8000-000000000001', place_name: 'Bukit Kiara',
  host_display_name: 'Community host', target_species_ids: ['mikania-micrantha'],
  meeting_latitude: 3.1497, meeting_longitude: 101.6412,
  start_at: new Date(Date.now() - 600_000).toISOString(), end_at: new Date(Date.now() + 3_600_000).toISOString(),
  permission_context: 'unknown', joined_count: 2, is_joined: true, participation_id: 'layout-participant',
  is_host: true, last_checkin_at: now,
}

export function install() {
  worker.use(
    http.get('*/api/v1/reports/mine', () => fixture.error
      ? HttpResponse.json({ detail: 'Test outage' }, { status: 503 })
      : HttpResponse.json({ items: fixture.empty ? [] : [{ ...report, status: fixture.status }] })),
    http.get('*/api/v1/reports/layout-report', () => fixture.error
      ? HttpResponse.json({ detail: 'Test outage' }, { status: 503 })
      : HttpResponse.json({ ...report, status: fixture.status })),
    http.get('*/api/v1/events', () => fixture.error
      ? HttpResponse.json({ detail: 'Test outage' }, { status: 503 })
      : HttpResponse.json({ items: fixture.empty ? [] : [event] })),
    http.get('*/api/v1/events/mine', () => HttpResponse.json({ items: fixture.empty ? [] : [event] })),
    http.get('*/api/v1/events/layout-event', () => HttpResponse.json(event)),
    http.get('*/api/v1/events/layout-event/summary', () => HttpResponse.json({
      reports_submitted_count: 3, distinct_species_count: 1, place_id: event.place_id,
      place_name: event.place_name, start_at: event.start_at, end_at: event.end_at, next_event: null,
    })),
    http.post('*/api/v1/events/layout-event/flag', () => HttpResponse.json({ flagged: true, hidden: false })),
  )
}

export function installErrors() {
  worker.use(http.get(/\/api\/v1\/(?:places|adopted-areas|events|reports)(?:\/|\?|$)/,
    () => HttpResponse.json({ detail: 'Test outage' }, { status: 503 })))
}
