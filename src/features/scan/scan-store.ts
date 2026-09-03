import { create } from 'zustand'
import type { GeoPoint, QualityResult, IdentifyResult, SpeciesDetail } from '@/types'
import { saveScanHistoryRecord } from './scan-history-store'

/**
 * Owns the state for whatever scan is currently in progress: the captured
 * image (both the object URL and the live ImageBitmap/Blob), the
 * quality-check and identification results, and the GPS fix taken alongside
 * the photo. This is in-memory only and gets reset on every new scan - it's
 * the "working" state for capture -> processing -> result. Once a scan
 * finishes, it gets written out to scan-history-store.ts (the durable local
 * record) and, for permission choices tied to a specific scan, into
 * guidance-decision-store.ts too. I split this into three separate stores
 * instead of one big one because they genuinely have different lifetimes -
 * this one is volatile per-scan, the other two persist across scans and
 * sessions in localStorage.
 */
let locationRequestGeneration = 0

type ScanStep = 'capture' | 'processing' | 'result'

/** Location captured when scanning. The report form reuses this value so the
 *  browser does not need to ask for location permission a second time. */
interface ScanLocation {
  point: GeoPoint
  accuracyM: number | null
  capturedAt: string  // ISO timestamp for when the coordinates were recorded.
}

interface ScanState {
  step: ScanStep
  imageUrl: string | null
  imageBitmap: ImageBitmap | null
  imageBlob: Blob | null
  captureSource: 'camera' | 'gallery' | null
  captureId: string | null
  observedAt: string | null
  quality: QualityResult | null
  result: IdentifyResult | null
  speciesDetail: SpeciesDetail | null
  location: ScanLocation | null
  locationStatus: 'idle' | 'locating' | 'ok' | 'denied' | 'unavailable' | 'timeout'
  // Report has to stay disabled until the scan has actually been persisted
  // server-side. 'pending' is the state right after a scan finishes but before
  // /api/v1/scans has come back; 'ok' is what unlocks reporting; 'failed'
  // surfaces a retry action instead.
  scanPersistStatus: 'pending' | 'ok' | 'failed'
  setScanPersistStatus: (s: 'pending' | 'ok' | 'failed') => void

  setImage: (
    url: string,
    bitmap: ImageBitmap,
    blob: Blob,
    source: 'camera' | 'gallery',
    captureId: string,
    observedAt: string,
  ) => void
  setQuality: (q: QualityResult) => void
  startProcessing: () => void
  cancelProcessing: () => void
  setResult: (r: IdentifyResult, detail: SpeciesDetail | null) => void
  setLocation: (loc: ScanLocation) => void
  setLocationStatus: (s: ScanState['locationStatus']) => void
  reset: () => void
}

function saveCurrentScan(
  scan: ScanState,
  result: IdentifyResult,
  detail: SpeciesDetail | null,
  location: ScanLocation | null,
): void {
  if (!scan.captureId || !scan.observedAt || !scan.captureSource) return
  saveScanHistoryRecord({
    captureId: scan.captureId,
    observedAt: scan.observedAt,
    captureSource: scan.captureSource,
    outcome: result.outcome,
    speciesId: result.speciesId ?? null,
    speciesName: result.speciesName ?? detail?.name ?? null,
    scientificName: result.scientificName ?? detail?.latinName ?? null,
    confidence: result.confidence,
    modelVersion: result.modelVersion,
    reportable: result.reportable,
    location: location?.point ?? null,
    locationAccuracyM: location?.accuracyM ?? null,
  })
}

export const useScan = create<ScanState>((set, get) => ({
  step: 'capture',
  imageUrl: null,
  imageBitmap: null,
  imageBlob: null,
  captureSource: null,
  captureId: null,
  observedAt: null,
  quality: null,
  result: null,
  speciesDetail: null,
  location: null,
  locationStatus: 'idle',
  scanPersistStatus: 'pending',
  setScanPersistStatus: (s) => set({ scanPersistStatus: s }),

  setImage: (url, bitmap, blob, captureSource, captureId, observedAt) => {
    const previous = get()
    // Object URLs and ImageBitmaps are real browser resources that don't just
    // get garbage collected the moment we stop referencing them. Skipping
    // this cleanup on every retake/rescan would slowly pile up memory over a
    // long field session, which is exactly the kind of thing that'd only show
    // up after someone's been out scanning for a while.
    if (previous.imageUrl) URL.revokeObjectURL(previous.imageUrl)
    previous.imageBitmap?.close()
    set({ imageUrl: url, imageBitmap: bitmap, imageBlob: blob,
          captureSource, captureId, observedAt,
          quality: null, result: null, speciesDetail: null,
          scanPersistStatus: 'pending' })
  },

  setQuality: (q) => set({ quality: q }),

  startProcessing: () => set({ step: 'processing' }),

  cancelProcessing: () => set({ step: 'capture' }),

  setResult: (r, detail) => {
    const scan = get()
    scan.imageBitmap?.close()
    saveCurrentScan(scan, r, detail, scan.location)
    set({ step: 'result', imageBitmap: null, result: r, speciesDetail: detail })
  },

  setLocation: (loc) => {
    const scan = get()
    // A warm model can actually finish before the GPS request comes back, so
    // if the location fix arrives late, this updates the history row that was
    // already saved - otherwise "View on map" would just be missing for that scan.
    if (scan.result) saveCurrentScan(scan, scan.result, scan.speciesDetail, loc)
    set({ location: loc, locationStatus: 'ok' })
  },
  setLocationStatus: (s) => set({ locationStatus: s }),

  reset: () => {
    locationRequestGeneration += 1
    const previous = get()
    if (previous.imageUrl) URL.revokeObjectURL(previous.imageUrl)
    previous.imageBitmap?.close()
    set({
      step: 'capture', imageUrl: null, imageBitmap: null, imageBlob: null,
      captureSource: null, captureId: null, observedAt: null,
      quality: null, result: null, speciesDetail: null,
      location: null, locationStatus: 'idle',
      scanPersistStatus: 'pending',
    })
  },
}))

/** Kicks off a location request without blocking the scan screen while it
 *  waits. The result, or the failure state, gets saved into the scan store so
 *  the report form can read it back later. */
export function captureScanLocation() {
  // geolocation.getCurrentPosition doesn't have a cancel API, so this
  // generation counter is the only way I found to ignore a stale GPS callback
  // landing after the user has already retaken the photo (which kicks off a
  // new request) or reset the scan entirely.
  const requestGeneration = ++locationRequestGeneration
  useScan.setState({ location: null, locationStatus: 'locating' })
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
    if (requestGeneration === locationRequestGeneration) {
      useScan.getState().setLocationStatus('unavailable')
    }
    return
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      if (requestGeneration !== locationRequestGeneration) return
      useScan.getState().setLocation({
        point: { lat: pos.coords.latitude, lng: pos.coords.longitude },
        accuracyM: Number.isFinite(pos.coords.accuracy) ? Math.round(pos.coords.accuracy) : null,
        capturedAt: new Date().toISOString(),
      })
    },
    (err) => {
      if (requestGeneration !== locationRequestGeneration) return
      useScan.getState().setLocationStatus(
        err.code === err.PERMISSION_DENIED ? 'denied'
          : err.code === err.TIMEOUT ? 'timeout' : 'unavailable',
      )
    },
    { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
  )
}
