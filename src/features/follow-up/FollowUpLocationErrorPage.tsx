import { Link } from 'react-router-dom'
import { FOLLOW_UP_LOCATION_ERRORS } from './follow-up-copy'
import './follow-up.css'

export function FollowUpLocationErrorPage({
  code,
  onTryAgain,
}: {
  code: string
  onTryAgain: () => void
}) {
  if (code === 'follow_up_not_available') {
    return (
      <main className="follow-up-page" aria-labelledby="follow-up-error-title">
        <section className="follow-up-panel follow-up-panel--error" role="alert">
          <h1 id="follow-up-error-title">This follow-up has already been recorded</h1>
          <p>The sighting changed while this check was open. Return to the map to review its current status.</p>
          <Link className="follow-up-button" to="/map">Return to map</Link>
        </section>
      </main>
    )
  }
  const isLocationError = code in FOLLOW_UP_LOCATION_ERRORS
  const copy = FOLLOW_UP_LOCATION_ERRORS[code] ?? {
    title: 'Follow-up could not be recorded',
    body: 'The service could not record this follow-up. Return to the map and try a fresh check when your connection is available.',
  }
  return (
    <main className="follow-up-page" aria-labelledby="follow-up-error-title">
      <section className="follow-up-panel follow-up-panel--error" role="alert">
        <h1 id="follow-up-error-title">{copy.title}</h1>
        <p>{copy.body}</p>
        <button type="button" className="follow-up-button" onClick={onTryAgain}>{isLocationError ? 'Try location again' : 'Start again'}</button>
      </section>
    </main>
  )
}
