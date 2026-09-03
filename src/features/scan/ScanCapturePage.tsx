import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { captureScanLocation, useScan } from '@/features/scan/scan-store'
import { resizeImage } from '@/features/scan/image-processing'
import { getAdapter } from '@/features/scan/plant-model-adapter'
import { api } from '@/services/api-client'
import { applyServerAcceptance, fetchModelConfig } from '@/services/model-config'
import type { SpeciesDetail } from '@/types'
import './scan-capture.css'

async function sha256HexOfBlob(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * The first screen in the scan flow. Lets the user open the live camera or
 * pick a photo from their library, runs the quality check on it and then the
 * actual plant-model inference, and hands off to ScanResultPage once that
 * succeeds. It also doubles as the "retake" screen when you come back here
 * from processing.
 *
 * I kept the camera and gallery as two separate file inputs so each button
 * only ever does one job. The `capture` attribute is what asks supported
 * phones to open straight to the rear camera; the other input just opens the
 * normal file picker.
 */
export function ScanCapturePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const mountedRef = useRef(false)
  // getUserMedia, image resize, and model inference don't have a native abort
  // signal, so these three counters are basically my own hand-rolled
  // cancellation. Bumping the relevant one makes any in-flight callback's "is
  // this still the request that started me" check come back false, so a stale
  // camera stream / resize / inference result from before a retake or unmount
  // can't sneak in and overwrite state that's already moved on.
  const cameraRequestRef = useRef(0)
  const imageRequestRef = useRef(0)
  const analysisRequestRef = useRef(0)
  const analysisRunningRef = useRef(false)
  const {
    imageUrl, quality, setImage, setQuality, startProcessing, cancelProcessing, setResult,
  } = useScan()
  const [checking, setChecking] = useState(false)
  const [analysing, setAnalysing] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [cameraStarting, setCameraStarting] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [modelProgress, setModelProgress] = useState<number | null>(null)

  const stopCamera = useCallback((message?: string) => {
    cameraRequestRef.current += 1
    const stream = streamRef.current
    streamRef.current = null
    stream?.getTracks().forEach((track) => track.stop())
    setCameraOpen(false)
    setCameraStarting(false)
    if (message) setCameraError(message)
  }, [])

  useEffect(() => {
    mountedRef.current = true
    let hiddenTimer: number | null = null
    const clearHiddenTimer = () => {
      if (hiddenTimer !== null) {
        window.clearTimeout(hiddenTimer)
        hiddenTimer = null
      }
    }
    const interruptCamera = () => {
      if (streamRef.current) {
        stopCamera('Camera closed when the app was interrupted. Reopen it when you are ready.')
      }
    }
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        // Short backgrounding (iOS permission prompts, pulling down the
        // notification shade) shouldn't tear the stream down — that made the
        // camera feel broken during pilot testing. So it waits a bit before
        // deciding the app was actually interrupted.
        clearHiddenTimer()
        hiddenTimer = window.setTimeout(() => {
          hiddenTimer = null
          if (document.visibilityState === 'hidden') interruptCamera()
        }, 3000)
      } else {
        clearHiddenTimer()
      }
    }
    const handlePageHide = () => {
      clearHiddenTimer()
      interruptCamera()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('pagehide', handlePageHide)
    return () => {
      // Leaving this screen has to cancel any camera start, resize, or model
      // inference still in flight — otherwise a background analyse() could
      // finish after the user has already navigated away and try to set state
      // on a component that's no longer mounted.
      mountedRef.current = false
      cameraRequestRef.current += 1
      imageRequestRef.current += 1
      analysisRequestRef.current += 1
      analysisRunningRef.current = false
      clearHiddenTimer()
      const stream = streamRef.current
      streamRef.current = null
      stream?.getTracks().forEach((track) => track.stop())
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('pagehide', handlePageHide)
    }
  }, [stopCamera])

  // Coming back here via "Back to capture" keeps imageBlob/quality around, but
  // scan-store's setResult already closed the ImageBitmap by that point. So I
  // rebuild it on mount here, otherwise the Analyse button would just wait on
  // the fallback path inside analyse() instead of having a bitmap ready.
  useEffect(() => {
    const { imageBitmap, imageBlob } = useScan.getState()
    if (imageBitmap || !imageBlob) return
    let cancelled = false
    void createImageBitmap(imageBlob, { imageOrientation: 'from-image' })
      .then((bmp) => {
        if (cancelled) { bmp.close(); return }
        const current = useScan.getState()
        if (current.imageBitmap || current.imageBlob !== imageBlob) { bmp.close(); return }
        useScan.setState({ imageBitmap: bmp })
      })
      .catch(() => { /* fallback path in analyse() handles this */ })
    return () => { cancelled = true }
  }, [])

  const prepareImage = async (input: Blob, source: 'camera' | 'gallery') => {
    const requestId = ++imageRequestRef.current
    setChecking(true)
    setAnalysisError(null)
    try {
      const { bitmap, url, blob } = await resizeImage(input)
      if (!mountedRef.current || requestId !== imageRequestRef.current) {
        bitmap.close()
        URL.revokeObjectURL(url)
        return
      }
      setImage(url, bitmap, blob, source, crypto.randomUUID(), new Date().toISOString())

      const adapter = getAdapter()
      const qualityResult = await adapter.quality(bitmap)
      if (requestId === imageRequestRef.current) setQuality(qualityResult)
    } catch (error) {
      if (requestId === imageRequestRef.current) {
        // I want to keep whatever specific message resizeImage() threw (empty
        // file, file too big, wrong MIME type, corrupt image) instead of
        // flattening it into one generic "could not process" message — a
        // specific reason is a lot more useful to the person holding the
        // phone. Also note setImage was never called on this path, so a
        // rejected photo never creates a scan-history record.
        const message = error instanceof Error && error.message
          ? error.message
          : 'Could not process this image. Try another photo.'
        setQuality({ ok: false, reason: message })
      }
    } finally {
      if (requestId === imageRequestRef.current) setChecking(false)
    }
  }

  const handleFile = async (
    e: React.ChangeEvent<HTMLInputElement>,
    source: 'camera' | 'gallery',
  ) => {
    const input = e.currentTarget
    const file = input.files?.[0]
    if (file) await prepareImage(file, source)
    input.value = ''
  }

  const openCamera = async () => {
    if (cameraStarting || streamRef.current) return
    setCameraError(null)
    const requestId = ++cameraRequestRef.current
    setCameraStarting(true)
    if (!navigator.mediaDevices?.getUserMedia) {
      cameraRef.current?.click()
      setCameraStarting(false)
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
        audio: false,
      })
      if (!mountedRef.current || requestId !== cameraRequestRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      captureScanLocation()
      const handleEnded = () => {
        if (streamRef.current !== stream || !mountedRef.current) return
        streamRef.current = null
        setCameraOpen(false)
        setCameraError('Camera stopped unexpectedly. Reopen it to continue.')
      }
      stream.getTracks().forEach((track) => track.addEventListener('ended', handleEnded, { once: true }))
      streamRef.current = stream
      setCameraOpen(true)
      // The <video> element only gets mounted after cameraOpen flips true, so
      // videoRef.current is still null on the very first tick. I originally just
      // used a single requestAnimationFrame here, but that ended up racing
      // React's commit on iOS Safari — the frame fired before the element had
      // actually landed in the DOM, videoRef.current stayed null, and the
      // stream got silently dropped, leaving a black square where the preview
      // should be. Polling across a few animation frames until the element
      // shows up fixed it, so a cold camera open doesn't need a manual retry
      // anymore.
      const attach = (attemptsLeft: number) => {
        if (streamRef.current !== stream || !mountedRef.current) return
        const video = videoRef.current
        if (!video) {
          if (attemptsLeft <= 0) {
            stopCamera('Camera preview could not start. Reopen the camera and try again.')
            return
          }
          requestAnimationFrame(() => attach(attemptsLeft - 1))
          return
        }
        video.srcObject = stream
        void video.play().catch(() => {
          if (streamRef.current === stream) {
            stopCamera('Camera preview could not start. Reopen the camera and try again.')
          }
        })
      }
      requestAnimationFrame(() => attach(10))
    } catch {
      if (requestId === cameraRequestRef.current) {
        setCameraError('Camera access was unavailable. Allow camera access and try again.')
      }
    } finally {
      if (requestId === cameraRequestRef.current && mountedRef.current) setCameraStarting(false)
    }
  }

  const captureFrame = async () => {
    const video = videoRef.current
    if (!video?.videoWidth || !video.videoHeight) return
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight))
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) return
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    stopCamera()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
    if (blob) await prepareImage(blob, 'camera')
  }

  const analyse = async () => {
    if (analysisRunningRef.current) return
    let { imageBitmap: bitmap } = useScan.getState()
    const { imageBlob } = useScan.getState()
    if (!imageBlob) return
    // setResult nulls the bitmap out after a prior run, so coming back here via
    // "Back to capture" leaves imageBlob around but no bitmap. Rebuilding it
    // from the blob here is what lets Analyse still work on the same photo.
    if (!bitmap) {
      try {
        bitmap = await createImageBitmap(imageBlob, { imageOrientation: 'from-image' })
      } catch {
        setAnalysisError('Could not reopen the photo. Retake it and try again.')
        return
      }
    }

    const requestId = ++analysisRequestRef.current
    analysisRunningRef.current = true
    setAnalysing(true)
    setAnalysisError(null)
    startProcessing()
    // This 15 second deadline covers the whole user-facing classification step
    // — from quality-checked photo through to a visible result — not just the
    // ONNX inference itself. If it's slower than that, the user should get a
    // retryable error instead of just staring at a spinner forever. The
    // scan-persistence POST is deliberately decoupled and runs after
    // navigation, so a slow backend can never eat into this budget.
    const FULL_OP_DEADLINE_MS = 15_000
    let deadlineTimer: number | undefined
    const deadline = new Promise<never>((_, reject) => {
      deadlineTimer = window.setTimeout(
        () => reject(new Error('Plant analysis timed out. Retake the photo and try again.')),
        FULL_OP_DEADLINE_MS,
      )
    })
    try {
      const adapter = getAdapter()
      const flow = (async () => {
        await adapter.detect(bitmap)
        const rawResult = await adapter.identify(imageBlob, (loaded, total) => {
          if (requestId === analysisRequestRef.current) {
            setModelProgress(Math.round((loaded / total) * 100))
          }
        })
        // Cross-check against the server-side gate when it's reachable. If the
        // model-config request fails (server down, or offline once the asset
        // cache kicks in), serverAccepted ends up false on the result — the
        // classification still shows, but Report stays blocked on the result
        // screen until the server can actually confirm it.
        const serverConfig = await fetchModelConfig()
        const result = applyServerAcceptance(rawResult, serverConfig)
        let detail: SpeciesDetail | null = null
        // Fetching species detail for every accepted supported label, not just
        // the reportable ones, is what lets information-only and
        // status-uncertain results also show their sourced general info and
        // Malaysia status.
        if (result.speciesId) {
          try {
            detail = await api<SpeciesDetail>(`/api/v1/species/${result.speciesId}`)
          } catch {
            // Species detail is optional; the result can still be shown from
            // the identification response and the bundled shared catalogue.
          }
        }
        return { result, detail }
      })()
      const { result, detail } = await Promise.race([flow, deadline])
      if (!mountedRef.current || requestId !== analysisRequestRef.current) return

      setResult({ ...result, reportable: Boolean(detail?.reportable ?? detail) }, detail)
      // Persisting the scan to the server happens in the background and is
      // deliberately decoupled from showing the result — navigate straight
      // away so the result screen lands within the 15 second budget. The
      // Report button on that screen reads scanPersistStatus and stays
      // disabled until this POST comes back 'ok', with a separate retryable
      // failure state if it doesn't.
      const { captureId, captureSource, setScanPersistStatus } = useScan.getState()
      if (captureId) {
        setScanPersistStatus('pending')
        void (async () => {
          try {
            const hashHex = await sha256HexOfBlob(imageBlob)
            await api('/api/v1/scans', {
              method: 'POST',
              body: JSON.stringify({
                captureId,
                predictedSpeciesId: result.outcome === 'target' ? result.speciesId ?? null : null,
                outcome: result.outcome,
                confidence: result.confidence,
                modelVersion: result.modelVersion,
                imageSha256Hex: hashHex,
                captureSource,
              }),
            })
            if (useScan.getState().captureId === captureId) setScanPersistStatus('ok')
          } catch {
            if (useScan.getState().captureId === captureId) setScanPersistStatus('failed')
          }
        })()
      }
      navigate('/scan/result', { replace: true, state: location.state })
    } catch {
      if (requestId === analysisRequestRef.current) {
        cancelProcessing()
        setAnalysisError(
          navigator.onLine
            ? 'Plant analysis could not finish within 15 seconds. Your photo is still available — try again.'
            : 'Plant analysis needs a connection for its first model download. Reconnect and try again.',
        )
      }
    } finally {
      if (deadlineTimer !== undefined) window.clearTimeout(deadlineTimer)
      if (requestId === analysisRequestRef.current) {
        analysisRunningRef.current = false
        setAnalysing(false)
        setModelProgress(null)
      }
    }
  }

  const retake = () => {
    imageRequestRef.current += 1
    analysisRequestRef.current += 1
    analysisRunningRef.current = false
    setAnalysisError(null)
    setAnalysing(false)
    setModelProgress(null)
    useScan.getState().reset()
    stopCamera()
    if (cameraRef.current) cameraRef.current.value = ''
    if (galleryRef.current) galleryRef.current.value = ''
  }

  const qualityFailed = quality && !quality.ok

  return (
    <div className="scan-capture">
      <input
        ref={cameraRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment"
        onChange={(event) => void handleFile(event, 'camera')} hidden
        aria-label="Take photo"
      />
      <input
        ref={galleryRef} type="file" accept="image/jpeg,image/png,image/webp"
        onChange={(event) => void handleFile(event, 'gallery')} hidden
        aria-label="Choose photo from gallery"
      />

      {!imageUrl && cameraOpen ? (
        <section className="scan-capture__live" aria-labelledby="live-camera-heading">
          <div className="scan-capture__live-heading">
            <div>
              <h2 id="live-camera-heading">Frame one clear plant feature</h2>
              <p>Keep the leaf or flower cluster inside the guide, then capture.</p>
            </div>
            <button type="button" onClick={() => stopCamera()} aria-label="Close camera">
              <Icon name="X" size={18} />
            </button>
          </div>
          <div className="scan-capture__live-view">
            <video ref={videoRef} playsInline muted aria-label="Live rear camera preview" />
            <span aria-hidden className="scan-capture__live-guide" />
          </div>
          <button type="button" onClick={() => void captureFrame()} className="scan-capture__shutter">
            <span aria-hidden />
            Capture plant photo
          </button>
        </section>
      ) : !imageUrl ? (
        <section className="scan-capture__start" aria-labelledby="capture-heading">
          <div className="scan-capture__intro">
            <span className="scan-capture__eyebrow">Plant identification</span>
            <h2 id="capture-heading">Photograph a clear plant feature</h2>
            <p>A close, well-lit view of one leaf or flower cluster gives the clearest result.</p>
          </div>

          <button
            type="button"
            onClick={() => void openCamera()}
            disabled={checking || cameraStarting}
            aria-busy={checking || cameraStarting}
            className="scan-capture__camera"
          >
            <span aria-hidden className="scan-capture__corner scan-capture__corner--tl" />
            <span aria-hidden className="scan-capture__corner scan-capture__corner--tr" />
            <span aria-hidden className="scan-capture__corner scan-capture__corner--bl" />
            <span aria-hidden className="scan-capture__corner scan-capture__corner--br" />
            <span className="scan-capture__camera-icon" aria-hidden>
              {checking || cameraStarting ? <Spinner /> : <Icon name="Camera" size={30} color="var(--ink)" />}
            </span>
            <strong>{checking ? 'Preparing photo…' : cameraStarting ? 'Starting camera…' : 'Open camera'}</strong>
            <span>{checking ? 'Checking image quality' : cameraStarting ? 'Waiting for camera access' : 'Uses your phone’s rear camera'}</span>
            <small>Fill the frame with the plant feature</small>
          </button>

          {cameraError && (
            <div className="scan-capture__camera-error" role="alert">
              <p>{cameraError}</p>
              <button
                type="button"
                onClick={() => cameraRef.current?.click()}
                className="scan-capture__camera-fallback"
              >
                <Icon name="Camera" size={16} color="var(--ink)" />
                Use device camera app
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => { captureScanLocation(); galleryRef.current?.click() }}
            disabled={checking}
            className="scan-capture__gallery"
            aria-describedby="gallery-photo-note"
          >
            <span className="scan-capture__gallery-icon" aria-hidden>
              <Icon name="ImagePlus" size={19} color="var(--green)" />
            </span>
            <span>
              <strong>Choose from library</strong>
              <small>JPEG, PNG or WebP</small>
            </span>
            <Icon name="ChevronRight" size={18} color="var(--muted)" />
          </button>
          <div className="scan-capture__gallery-note" id="gallery-photo-note">
            <Icon name="Info" size={16} color="var(--green-dark)" />
            <p><strong>About library photos</strong> Cropped, compressed or older photos may return a lower-confidence result. Choosing from your library does not make a plant more likely to be marked high risk.</p>
          </div>
        </section>
      ) : (
        <div className="scan-capture__preview">
          <img src={imageUrl} alt="Captured plant" />

          {qualityFailed && (
            <div className="scan-capture__quality-fail" role="alert">
              <Icon name="AlertTriangle" size={24} color="#fff" />
              <div>
                <strong>Photo needs another try</strong>
                <p>{quality.reason}</p>
              </div>
              <button type="button" onClick={retake} className="scan-capture__retake">
                <Icon name="RotateCcw" size={16} color="var(--ink)" />
                Retake photo
              </button>
            </div>
          )}

          {!qualityFailed && (
            <button type="button" onClick={retake} aria-label="Discard photo and retake"
              className="scan-capture__discard">
              <Icon name="X" size={16} color="#fff" />
            </button>
          )}
        </div>
      )}

      {imageUrl && quality?.ok && (
        <div className="scan-capture__ready">
          <div className="scan-capture__quality-pass" role="status">
            <Icon name="Check" size={16} color="var(--green)" />
            <span>Photo quality check passed</span>
          </div>

          <button
            type="button"
            onClick={analyse}
            disabled={analysing}
            aria-busy={analysing}
            className="scan-capture__analyse"
          >
            {analysing ? (
              <>
                <Spinner />
                {modelProgress === null ? 'Preparing model…' : `Loading model… ${modelProgress}%`}
              </>
            ) : (
              <>
                <Icon name="Search" size={18} color="#fff" />
                Analyse plant
              </>
            )}
          </button>
          {analysisError && (
            <p className="scan-capture__analysis-error" role="alert">{analysisError}</p>
          )}
        </div>
      )}

      <section className="scan-capture__guidance" aria-labelledby="capture-guidance-heading">
        <h3 id="capture-guidance-heading">Before you capture</h3>
        <ul>
          <li><Icon name="Check" size={15} color="var(--green)" /><span>Use one leaf or flower cluster as the subject.</span></li>
          <li><Icon name="Check" size={15} color="var(--green)" /><span>Move close enough for it to fill most of the frame.</span></li>
          <li><Icon name="Check" size={15} color="var(--green)" /><span>Use even light and hold the phone steady.</span></li>
        </ul>
      </section>
    </div>
  )
}

function Spinner() {
  return (
    <svg className="scan-capture__spinner" width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <circle cx="9" cy="9" r="7" stroke="rgba(255,255,255,0.3)" strokeWidth="2.5" fill="none" />
      <path d="M9 2a7 7 0 0 1 7 7" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" fill="none" />
    </svg>
  )
}
