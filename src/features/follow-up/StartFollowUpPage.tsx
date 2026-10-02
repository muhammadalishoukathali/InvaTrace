import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { FollowUpLocation } from '@/services/api/followUp'
import './follow-up.css'

const MAX_ACCURACY_M = 250

export function StartFollowUpPage({ onLocation }: { onLocation: (location: FollowUpLocation) => void }) {
  const { sightingId } = useParams()
  const navigate = useNavigate()
  const [location, setLocation] = useState<FollowUpLocation | null>(null)
  const [message, setMessage] = useState('')
  const [locating, setLocating] = useState(false)
  const requestSequence = useRef(0)
  const mounted = useRef(true)

  useEffect(() => {
    // StrictMode runs setup/cleanup once before the real mount in development.
    // Restore this guard during setup so the real browser GPS callback is not
    // mistaken for an obsolete request.
    mounted.current = true
    return () => {
      mounted.current = false
      requestSequence.current += 1
    }
  }, [])

  const locate = () => {
    if (!navigator.geolocation) { setMessage('This browser cannot provide a GPS location.'); return }
    const requestId = requestSequence.current + 1
    requestSequence.current = requestId
    setLocating(true)
    setMessage('')
    setLocation(null)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!mounted.current || requestId !== requestSequence.current) return
        setLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyM: position.coords.accuracy,
          capturedAt: new Date(position.timestamp).toISOString(),
        })
        setLocating(false)
      },
      () => {
        if (!mounted.current || requestId !== requestSequence.current) return
        setMessage('Location access was not available. Enable it and try again.')
        setLocating(false)
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 },
    )
  }
  const ready = location !== null && location.accuracyM <= MAX_ACCURACY_M
  return (
    <main className="follow-up-page" aria-labelledby="follow-up-title">
      <section className="follow-up-panel">

        <h1 id="follow-up-title">Confirm your current location</h1>
        <p>Use a fresh GPS reading while you are near the reported plant. Follow-up needs accuracy of 250 m or better.</p>
        <div className="follow-up-location" aria-live="polite">
          {location ? <><strong>GPS accuracy: ±{Math.round(location.accuracyM)} m</strong><span>{ready ? 'Ready to continue.' : 'Move outdoors and refresh location for a more accurate reading.'}</span></> : <span>{message || 'No current location yet.'}</span>}
        </div>
        <button type="button" className="follow-up-button follow-up-button--secondary" onClick={locate} disabled={locating}>
          {locating ? 'Finding location…' : location ? 'Refresh location' : 'Use my current location'}
        </button>
        <button type="button" className="follow-up-button" disabled={!ready} onClick={() => { if (location) { onLocation(location); navigate(`/sightings/${sightingId}/follow-up/outcome`) } }}>
          Continue
        </button>
      </section>
    </main>
  )
}
