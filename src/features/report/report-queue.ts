/**
 * This whole file handles what happens when a report submission can't
 * finish right away. Normally submitting means: ask the server for an
 * upload URL, upload the photo to it, then create the report - three
 * network calls that all need to succeed. If any one of them fails (bad
 * connection while out in the field, most likely) we save the report and
 * the photo blob locally in IndexedDB instead of just losing the user's
 * work. `flushQueue` is what goes back and retries all those same steps
 * once we're back online and the API session is ready again.
 */
import type { PresignedUpload, QueuedReport, Report, ReportSubmission } from '@/types'
import { api, ApiError } from '@/services/api-client'
import { usePrivateAccess } from '@/features/private-access/private-access-store'
import { updateScanHistorySubmission } from '@/features/scan/scan-history-store'

const REPORT_QUEUE_DB_NAME = 'invatrace'
const REPORT_QUEUE_DB_VERSION = 1
const REPORT_QUEUE_STORE_NAME = 'report-queue'

function openReportQueueDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(REPORT_QUEUE_DB_NAME, REPORT_QUEUE_DB_VERSION)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(REPORT_QUEUE_STORE_NAME)) {
        database.createObjectStore(REPORT_QUEUE_STORE_NAME, { keyPath: 'id' })
      }
    }
  })
}

async function readQueuedReports(): Promise<QueuedReport[]> {
  const database = await openReportQueueDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(REPORT_QUEUE_STORE_NAME, 'readonly')
    const request = transaction.objectStore(REPORT_QUEUE_STORE_NAME).getAll()
    request.onsuccess = () => resolve(request.result as QueuedReport[])
    request.onerror = () => reject(request.error)
  })
}

async function saveQueuedReport(item: QueuedReport): Promise<void> {
  const database = await openReportQueueDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(REPORT_QUEUE_STORE_NAME, 'readwrite')
    transaction.objectStore(REPORT_QUEUE_STORE_NAME).put(item)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
}

async function deleteQueuedReport(id: string): Promise<void> {
  const database = await openReportQueueDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(REPORT_QUEUE_STORE_NAME, 'readwrite')
    transaction.objectStore(REPORT_QUEUE_STORE_NAME).delete(id)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
}

/* Asks the API for a temporary upload URL, PUTs the image straight to it,
 * and hands back the photo key that has to go into the report request. */
async function uploadImage(blob: Blob, idempotencyKey: string): Promise<string> {
  const presigned = await api<PresignedUpload>('/api/v1/uploads/presign', {
    method: 'POST',
    headers: { 'Idempotency-Key': `${idempotencyKey}:upload` },
    body: JSON.stringify({ contentType: blob.type, sizeBytes: blob.size }),
  })
  const putRes = await fetch(presigned.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': blob.type },
    body: blob,
  })
  if (!putRes.ok) throw new UploadError(putRes.status)
  return presigned.photoKey
}

class UploadError extends Error {
  constructor(public status: number) {
    super(`Upload failed: HTTP ${status}`)
    this.name = 'UploadError'
  }
}

const REUSABLE_UPLOAD_ERRORS = new Set([
  'upload_expired',
  'upload_not_issued',
  'upload_incomplete',
  'upload_mismatch',
  'upload_changed',
])

/* Decides whether a failed submission should get queued for a retry or
 * just fail outright and surface an error. Anything that looks temporary -
 * being offline, a network blip, the upload URL expiring, the server being
 * overloaded or rate-limiting us - gets queued. But if the screening
 * pipeline itself rejected the submission (a 4xx that isn't one of the
 * upload-token codes), retrying won't change anything, it'll just be the
 * same rejection again, so we don't bother queueing those. */
function shouldRetry(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true
  if (error instanceof UploadError || error instanceof TypeError) return true
  if (!(error instanceof ApiError)) return false
  return error.status >= 500
    || [408, 425, 429].includes(error.status)
    || (error.code !== null && REUSABLE_UPLOAD_ERRORS.has(error.code))
}

async function createReport(
  submission: ReportSubmission,
  idempotencyKey: string,
  queuedRetry: boolean,
): Promise<Report> {
  // We send along the bundled catalogue version and its checksum so the
  // backend can catch it with a 409 if this client's plant-status data has
  // drifted out of date, rather than silently committing against stale
  // data. This is a lazy import on purpose - it keeps the module
  // tree-shakeable when report-queue.ts gets loaded on a page that never
  // actually submits anything, like the history view.
  const { catalogueVersion, plantStatusChecksum } = await import('@shared/catalogue')
  return api<Report>('/api/v1/reports', {
    method: 'POST',
    headers: {
      'Idempotency-Key': idempotencyKey,
      'X-InvaTrace-Catalogue-Version': catalogueVersion(),
      'X-InvaTrace-Catalogue-Sha256': plantStatusChecksum(),
      ...(queuedRetry ? { 'X-InvaTrace-Queued': 'true' } : {}),
    },
    body: JSON.stringify(submission),
  })
}

interface SubmitOutcome {
  status: 'submitted' | 'queued'
  report?: Report
  queuedId?: string
  error?: string
}

/**
 * Submits one report end to end. If a network or server failure happens
 * partway through, we just save the report locally with whatever photo key
 * it had (possibly empty if we never even got that far) - the retry logic
 * later on always grabs a fresh upload URL rather than reusing the old one,
 * since those URLs expire.
 */
export async function submitReport(
  submission: Omit<ReportSubmission, 'photoKey'>,
  imageBlob: Blob,
): Promise<SubmitOutcome> {
  const ownerProfileId = usePrivateAccess.getState().profile?.id
  if (!ownerProfileId) throw new Error('Private access must be ready before submitting a report.')
  // We derive the queue id (which doubles as the report-create
  // Idempotency-Key) from the scan's stable captureId instead of just
  // generating a fresh UUID every call. That way if the user double-taps
  // Submit on a slow connection, or re-enters the wizard for the same scan,
  // the server sees the same key both times and just replays the original
  // response instead of creating a duplicate Report row. Mixing in the
  // photo's sha256 and the profile id still gives a different key if either
  // of those actually change.
  const imageSha256 = await sha256Hex(imageBlob)
  const queuedId = await deriveQueuedId(submission.captureId, ownerProfileId, imageSha256)
  let photoKey = ''
  try {
    photoKey = await uploadImage(imageBlob, queuedId)
    const report = await createReport({ ...submission, photoKey, imageSha256 }, queuedId, false)
    updateScanHistorySubmission(submission.captureId, { status: 'submitted', reportId: report.id })
    return { status: 'submitted', report }
  } catch (error) {
    if (!shouldRetry(error)) throw error
    await saveQueuedReport({
      id: queuedId,
      ownerProfileId,
      createdAt: new Date().toISOString(),
      attempts: 1,
      retryable: true,
      lastError: error instanceof Error ? error.message : String(error),
      submission: { ...submission, photoKey, imageSha256 },
      imageBlob,
    })
    updateScanHistorySubmission(submission.captureId, { status: 'queued' })
    notifyQueueChanged()
    return { status: 'queued', queuedId, error: error instanceof Error ? error.message : String(error) }
  }
}

async function deriveQueuedId(captureId: string, profileId: string, imageSha256: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${captureId}|${profileId}|${imageSha256}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function sendQueuedReport(item: QueuedReport): Promise<Report> {
  if (!item.submission.photoKey) {
    item.submission.photoKey = await uploadImage(item.imageBlob, item.id)
    await saveQueuedReport(item)
  }
  try {
    return await createReport(item.submission, item.id, true)
  } catch (error) {
    // If the upload URL went stale, just retrying createReport won't fix
    // anything - we have to redo the whole upload with a fresh presigned URL
    // first. We suffix the retry's idempotency key with the attempt count so
    // it doesn't collide with the original, now-dead upload key on the server.
    if (!(error instanceof ApiError) || !error.code || !REUSABLE_UPLOAD_ERRORS.has(error.code)) {
      throw error
    }
    item.submission.photoKey = ''
    await saveQueuedReport(item)
    item.submission.photoKey = await uploadImage(
      item.imageBlob,
      `${item.id}:retry:${item.attempts}`,
    )
    await saveQueuedReport(item)
    return createReport(item.submission, item.id, true)
  }
}

/* Goes through each retryable report that belongs to the current private
 * profile and gives it one attempt. */
export async function flushQueue(): Promise<{ sent: number; failed: number; skipped: number }> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { sent: 0, failed: 0, skipped: 0 }
  }
  const ownerProfileId = usePrivateAccess.getState().profile?.id
  if (!ownerProfileId) return { sent: 0, failed: 0, skipped: 0 }
  const items = await readQueuedReports()
  let sent = 0, failed = 0, skipped = 0
  for (const item of items) {
    // The queue is one shared IndexedDB store for the whole device, so it
    // can end up holding reports left over from a different private profile
    // (say, after restoring a different profile on the same device), or
    // reports the screening pipeline already told us will never succeed on
    // retry. We skip both cases rather than resending under the wrong
    // identity, or retrying something forever that's never going to work.
    if (item.ownerProfileId !== ownerProfileId || item.retryable === false) {
      skipped++
      continue
    }
    try {
      const report = await sendQueuedReport(item)
      await deleteQueuedReport(item.id)
      updateScanHistorySubmission(item.submission.captureId, { status: 'submitted', reportId: report.id })
      sent++
    } catch (error) {
      item.attempts++
      item.retryable = shouldRetry(error)
      item.lastError = error instanceof Error ? error.message : String(error)
      await saveQueuedReport(item)
      failed++
    }
  }
  if (sent > 0 || failed > 0) notifyQueueChanged()
  return { sent, failed, skipped }
}

export async function listQueuedReports(
  ownerProfileId: string | null | undefined = usePrivateAccess.getState().profile?.id,
): Promise<QueuedReport[]> {
  if (!ownerProfileId) return []
  return (await readQueuedReports()).filter((item) => item.ownerProfileId === ownerProfileId)
}
export async function discardQueuedReport(id: string): Promise<void> {
  const item = (await readQueuedReports()).find((candidate) => candidate.id === id)
  await deleteQueuedReport(id)
  if (item) updateScanHistorySubmission(item.submission.captureId, undefined)
  notifyQueueChanged()
}

const listeners = new Set<() => void>()
export function onReportQueueChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
function notifyQueueChanged() { listeners.forEach((fn) => fn()) }
