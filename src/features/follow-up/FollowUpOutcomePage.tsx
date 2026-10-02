import { Link, useNavigate, useParams } from 'react-router-dom'
import type { FollowUpOutcome } from '@/services/api/followUp'
import { OUTCOME_COPY } from './follow-up-copy'
import './follow-up.css'

export function FollowUpOutcomePage({
  outcome,
  onOutcome,
}: {
  outcome: FollowUpOutcome | null
  onOutcome: (outcome: FollowUpOutcome) => void
}) {
  const { sightingId } = useParams()
  const navigate = useNavigate()
  return <section className="follow-up-page" aria-labelledby="follow-up-outcome-title"><section className="follow-up-panel">
    <Link className="back-link" to={`/sightings/${sightingId}/follow-up`}>Back to location</Link><h1 id="follow-up-outcome-title">What did you find?</h1>
    <fieldset className="follow-up-options"><legend>Choose one outcome</legend>
      {(Object.entries(OUTCOME_COPY) as [FollowUpOutcome, typeof OUTCOME_COPY[FollowUpOutcome]][]).map(([value, copy]) => <label key={value} className={`follow-up-option${outcome === value ? ' follow-up-option--selected' : ''}`}>
        <input type="radio" name="follow-up-outcome" value={value} checked={outcome === value} onChange={() => onOutcome(value)} /><span><strong>{copy.label}</strong><small>{copy.description}</small></span>
      </label>)}
    </fieldset>
    {outcome && <aside className="follow-up-preview" aria-live="polite"><strong>Marker preview</strong><p>{OUTCOME_COPY[outcome].next}</p></aside>}
    <button className="follow-up-button" type="button" disabled={!outcome} onClick={() => { if (outcome) { onOutcome(outcome); navigate(`/sightings/${sightingId}/follow-up/confirm`) } }}>Review follow-up</button>
  </section></section>
}
