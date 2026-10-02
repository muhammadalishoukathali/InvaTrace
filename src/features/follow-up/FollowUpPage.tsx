import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import type { FollowUpLocation, FollowUpOutcome } from '@/services/api/followUp'
import { StartFollowUpPage } from './StartFollowUpPage'
import { FollowUpOutcomePage } from './FollowUpOutcomePage'
import { FollowUpConfirmPage } from './FollowUpConfirmPage'
import { FollowUpLocationErrorPage } from './FollowUpLocationErrorPage'

export function FollowUpPage() {
  const locationPath = useLocation().pathname
  const navigate = useNavigate()
  const { sightingId } = useParams()
  const [location, setLocation] = useState<FollowUpLocation | null>(null)
  const [outcome, setOutcome] = useState<FollowUpOutcome | null>(null)
  const [error, setError] = useState<string | null>(null)
  const workflowSightingId = useRef(sightingId)
  const basePath = `/sightings/${sightingId}/follow-up`
  const atConfirm = locationPath.endsWith('/confirm')
  const atError = locationPath.endsWith('/error')
  // State belongs to one sighting only. A client-side route transition can
  // reuse this component, so do not let a GPS fix or outcome cross into the
  // next sighting while React is waiting to run the reset effect.
  const isCurrentWorkflow = workflowSightingId.current === sightingId
  const currentLocation = isCurrentWorkflow ? location : null
  const currentOutcome = isCurrentWorkflow ? outcome : null

  useEffect(() => {
    if (workflowSightingId.current === sightingId) return
    workflowSightingId.current = sightingId
    setLocation(null)
    setOutcome(null)
    setError(null)
  }, [sightingId])

  // A bookmarked confirmation route has no browser GPS fix in memory. Route
  // it back after render instead of navigating during render.
  useEffect(() => {
    // Submission rejection clears the fix before moving to /error. Do not
    // race that navigation back to the start route; an absent error is the
    // signal that this was simply a direct/bookmarked confirmation URL.
    if (atConfirm && !error && (!currentLocation || !currentOutcome)) navigate(basePath, { replace: true })
  }, [atConfirm, basePath, currentLocation, currentOutcome, error, navigate])

  const beginAgain = () => {
    setError(null)
    navigate(basePath, { replace: true })
  }

  const handleLocationRejected = (code: string) => {
    // A rejected fix must never be available again through browser Back.
    setLocation(null)
    setError(code)
    navigate(`${basePath}/error`, { replace: true })
  }

  const handleStateChanged = () => {
    setLocation(null)
    setOutcome(null)
    setError('follow_up_not_available')
    navigate(`${basePath}/error`, { replace: true })
  }

  if (atError) {
    return <FollowUpLocationErrorPage code={error ?? 'unknown'} onTryAgain={beginAgain} />
  }
  if (atConfirm) {
    if (!currentLocation || !currentOutcome) return null
    return (
      <FollowUpConfirmPage
        location={currentLocation}
        outcome={currentOutcome}
        onLocationRejected={handleLocationRejected}
        onStateChanged={handleStateChanged}
      />
    )
  }
  if (locationPath.endsWith('/outcome')) {
    return <FollowUpOutcomePage outcome={currentOutcome} onOutcome={setOutcome} />
  }
  return <StartFollowUpPage key={sightingId} onLocation={(nextLocation) => {
    setLocation(nextLocation)
    setError(null)
  }} />
}
