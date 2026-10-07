import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { BackLink } from '@/components/BackLink'
import { Icon } from '@/components/Icon'
import { api } from '@/services/api-client'
import type { FollowUpLocation } from '@/services/api/followUp'
import type { SightingDetail } from '@/types'
import './follow-up.css'

// Same limits the server enforces (backend sightings router FOLLOW_UP_MAX_M).
const MAX_ACCURACY_M = 250
const MAX_DISTANCE_M = 250
// Public coordinates of an unvetted report are displaced by 100 m
// (backend app/core/privacy.py). The server measures against the exact point,
// so the pre-check widens by that offset rather than wrongly blocking a user
// who is standing at the plant.
const PRIVACY_OFFSET_M = 100

/**
 * AC 4.7.1: show the measured accuracy and allow the follow-up only within
 * 250 m of the original marker at 250 m accuracy or better. The server checks
 * again on submit; this check just tells the user before they fill anything in.
 */
export function StartFollowUpPage({ onLocation }: { onLocation: (location: FollowUpLocation) => void }) {
  const { sightingId } = useParams()
  const navigate = useNavigate()
  const [location, setLocation] = useState<FollowUpLocation | null>(null)
  const [message, setMessage] = useState('')
  const [locating, setLocating] = useState(false)
  const requestSequence = useRef(0)
  const mounted = useRef(true)
  const sighting = useQuery({
    queryKey: ['sighting', sightingId],
    queryFn: () => api<SightingDetail>(`/api/v1/sightings/${encodeURIComponent(sightingId ?? '')}`),
    enabled: Boolean(sightingId),
  })

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
      (error) => {
        if (!mounted.current || requestId !== requestSequence.current) return
        setMessage(geolocationErrorMessage(error))
        setLocating(false)
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 },
    )
  }

  const marker = sighting.data?.location
  const distanceM = location && marker ? Math.round(haversineMetres(location, marker)) : null
  const accuracyOk = location !== null && Number.isFinite(location.accuracyM) && location.accuracyM <= MAX_ACCURACY_M
  const distanceLimit = MAX_DISTANCE_M + (sighting.data?.precisionReduced ? PRIVACY_OFFSET_M : 0)
  // If the marker could not be loaded, let the server make the distance call.
  // While it is still loading, wait rather than skipping the check.
  const distanceOk = distanceM === null ? sighting.isError : distanceM <= distanceLimit
  // A sighting that no longer awaits follow-up (resolved, regrowth, or already
  // changed by someone else) cannot take one; the server would reject it.
  const followUpOpen = !sighting.data || sighting.data.followUpState === 'needed'
  const ready = accuracyOk && distanceOk && followUpOpen
  const backTo = sightingId ? `/map?sighting=${encodeURIComponent(sightingId)}` : '/map'

  return (
    <section className="follow-up-page" aria-labelledby="follow-up-title">
      <BackLink to={backTo}>Back to sighting</BackLink>
      <div className="follow-up-panel">
        <p className="follow-up-kicker">Step 1 of 3 · Location</p>
        <h2 id="follow-up-title">Check you are at the plant</h2>
        {sighting.data && (
          <p className="follow-up-target"><Icon name="MapPin" size={16} /><span><strong>{sighting.data.speciesName}</strong> · removal reported earlier · follow-up needed</span></p>
        )}
        <p>Use a fresh GPS reading while you stand near the reported plant. You need to be within {MAX_DISTANCE_M} m of the marker with accuracy of {MAX_ACCURACY_M} m or better.</p>

        <div className="follow-up-checks" aria-live="polite">
          <div className={`follow-up-check${location ? (accuracyOk ? ' is-ok' : ' is-bad') : ''}`}>
            <span>GPS accuracy</span>
            <strong>{location ? `±${Math.round(location.accuracyM)} m` : '—'}</strong>
            <small>{location ? (accuracyOk ? 'Good enough' : `Needs ${MAX_ACCURACY_M} m or better`) : 'Not measured yet'}</small>
          </div>
          <div className={`follow-up-check${distanceM !== null ? (distanceOk ? ' is-ok' : ' is-bad') : ''}`}>
            <span>Distance to marker</span>
            <strong>{distanceM !== null ? formatDistance(distanceM) : '—'}</strong>
            <small>{distanceM !== null ? (distanceOk ? 'Close enough' : `Move within ${MAX_DISTANCE_M} m`) : sighting.isError ? 'Checked when you submit' : location ? 'Loading marker…' : 'Not measured yet'}</small>
          </div>
        </div>
        {!followUpOpen && (
          <p className="follow-up-alert" role="alert">This sighting no longer needs a follow-up. Return to the map to see its current status.</p>
        )}
        {message && <p className="follow-up-alert" role="alert">{message}</p>}
        {location && followUpOpen && (!accuracyOk || (distanceM !== null && !distanceOk)) && (
          <p className="follow-up-alert" role="alert">
            {!accuracyOk
              ? 'Your location is not accurate enough yet. Move into the open and refresh.'
              : `You are ${formatDistance(distanceM ?? 0)} from the marker. Move closer to the reported plant and refresh. The marker stays unchanged until a follow-up is recorded.`}
          </p>
        )}

        <div className="follow-up-actions">
          <button type="button" className="follow-up-button follow-up-button--secondary" onClick={locate} disabled={locating}>
            <Icon name="Crosshair" size={17} />{locating ? 'Finding location…' : location ? 'Refresh location' : 'Use my current location'}
          </button>
          <button type="button" className="follow-up-button" disabled={!ready} onClick={() => { if (location) { onLocation(location); navigate(`/sightings/${sightingId}/follow-up/outcome`) } }}>
            Continue
          </button>
        </div>
      </div>
    </section>
  )
}

function geolocationErrorMessage(error: GeolocationPositionError) {
  if (error.code === error.PERMISSION_DENIED) return 'Location permission is blocked. Allow location for InvaTrace in your browser settings, then try again.'
  if (error.code === error.TIMEOUT) return 'Finding your location took too long. Move into the open and try again.'
  return 'Your device could not provide a location right now. Try again in a moment.'
}

const formatDistance = (metres: number) => (metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${metres} m`)

function haversineMetres(a: { latitude: number; longitude: number }, b: { lat: number; lng: number }) {
  const radius = 6_371_000
  const toRad = (value: number) => value * Math.PI / 180
  const dLat = toRad(b.lat - a.latitude)
  const dLng = toRad(b.lng - a.longitude)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * radius * Math.asin(Math.sqrt(h))
}
