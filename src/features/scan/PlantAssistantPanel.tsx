import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { IdentifyResult } from '@/types'
import { api, ApiError } from '@/services/api-client'
import { findApprovedSpecies } from '@shared/catalogue'
import './plant-assistant.css'

interface AssistantResponse {
  status: 'answer' | 'fallback' | 'insufficient_evidence' | 'unsupported_scan'
  answerability: 'answerable' | 'insufficient_evidence'
  answer: string
  safetyBoundary: string
  coveredTopics?: string[]
  sources: Array<{ chunkId: string; sourceName: string; sourceUrl: string; jurisdiction: string;
    attribution?: string | null; sourceLicense?: string | null; sourceLicenseUrl?: string | null }>
}

const TOPIC_LABELS: Record<string, string> = {
  identification: 'Identification', habitat: 'Habitat', impact: 'Impact',
  spread: 'Spread pathways', safe_response: 'Safe response', documented_hazards: 'Documented hazards',
  names_status: 'Names and status', origin: 'Origin', life_cycle: 'Life cycle',
}

type Depth = 'standard' | 'simpler' | 'detailed'
const DEPTHS: Array<{ depth: Depth; label: string; ariaLabel?: string }> = [
  { depth: 'simpler', label: 'Simpler', ariaLabel: 'Simpler explanation' },
  { depth: 'standard', label: 'Standard', ariaLabel: 'Standard explanation' },
  { depth: 'detailed', label: 'More detail' },
]
const SPREAD_QUESTION = 'How does it spread?'
const SUGGESTIONS = [
  'What does this plant look like?',
  'Where does it grow?',
  'What are its impacts?',
  SPREAD_QUESTION,
  'How should I respond safely?',
]
// Species whose reviewed knowledge pack documents spread pathways. Kept in step
// with the backend by backend/tests/test_assistant_suggestions.py.
export const SPREAD_DOCUMENTED_SPECIES = new Set([
  'bidens-pilosa', 'chromolaena-odorata', 'cynodon-dactylon', 'cyperus-rotundus',
  'eichhornia-crassipes', 'eleusine-indica', 'impatiens-balsamina', 'limnocharis-flava',
  'mikania-micrantha', 'mimosa-diplotricha', 'mimosa-pigra', 'oxalis-corniculata',
  'parthenium-hysterophorus', 'psidium-guajava', 'ruellia-blechum', 'salvinia-molesta', 'sida-acuta',
])

export function suggestionsFor(speciesId: string) {
  return SUGGESTIONS.filter(text => text !== SPREAD_QUESTION || SPREAD_DOCUMENTED_SPECIES.has(speciesId))
}

export function assistantSpeciesForScan(result: IdentifyResult) {
  if (result.outcome === 'other_plant' || result.outcome === 'uncertain') return null
  return findApprovedSpecies({ speciesId: result.speciesId, scientificName: result.scientificName })
}

export function PlantAssistantPanel({ result }: { result: IdentifyResult }) {
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [response, setResponse] = useState<AssistantResponse | null>(null)
  const [responseQuestion, setResponseQuestion] = useState('')
  const [responseDepth, setResponseDepth] = useState<Depth>('standard')
  // Set when a level change returned the same approved wording as before.
  const [unchangedDepth, setUnchangedDepth] = useState<Depth | null>(null)
  const lastAnswers = useRef(new Map<string, string>())
  const [pending, setPending] = useState(false)
  const [repeat, setRepeat] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const answered = useRef(new Set<string>())
  const controller = useRef<AbortController | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const responseHeading = useRef<HTMLHeadingElement>(null)
  const revealResponse = useRef(false)
  const species = assistantSpeciesForScan(result)
  const supported = Boolean(species)

  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => { if (open) heading.current?.focus() }, [open])
  // A suggested question is tapped above the fold on phones, so bring the
  // answer into view instead of leaving it below the action dock.
  useEffect(() => {
    if (!response || pending || !revealResponse.current) return
    revealResponse.current = false
    const target = responseHeading.current
    if (!target) return
    target.focus({ preventScroll: true })
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    target.closest('.plant-assistant__response')?.scrollIntoView?.({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' })
  }, [response, pending])

  const submitQuestion = async (text: string, depth: Depth = 'standard', clarify = true) => {
    const trimmed = text.trim()
    if (!trimmed || pending) return
    setError(null)
    if (clarify && answered.current.has(trimmed.toLowerCase())) {
      setRepeat(trimmed)
      return
    }
    setRepeat(null)
    setResponse(null)
    setPending(true)
    const attempt = new AbortController()
    controller.current = attempt
    const timeout = window.setTimeout(() => attempt.abort(), 25_000)
    try {
      const next = await api<AssistantResponse>('/api/v1/plant-assistant/ask', {
        method: 'POST', signal: attempt.signal, cache: 'no-store',
        body: JSON.stringify({
          speciesId: supported ? species!.species_id : null,
          classifierConfidence: result.confidence,
          classifierOutcome: result.outcome,
          question: trimmed, depth,
        }),
      })
      if (attempt.signal.aborted) return
      const key = trimmed.toLowerCase()
      setUnchangedDepth(depth !== 'standard' && lastAnswers.current.get(key) === next.answer ? depth : null)
      lastAnswers.current.set(key, next.answer)
      setResponse(next)
      setResponseQuestion(trimmed)
      setResponseDepth(depth)
      setQuestion('')
      revealResponse.current = true
      if (next.answerability === 'answerable') answered.current.add(trimmed.toLowerCase())
    } catch (cause) {
      setError(cause instanceof ApiError && cause.status === 429
        ? 'You have asked several questions recently. Wait a minute, then try again.'
        : 'The assistant could not be reached. Check your connection and try again, or open the catalogue entry.')
    } finally {
      window.clearTimeout(timeout)
      if (controller.current === attempt) setPending(false)
    }
  }

  const submit = (event: FormEvent) => { event.preventDefault(); void submitQuestion(question) }
  const sourcesByUrl = new Map<string, AssistantResponse['sources'][number]>()
  for (const source of response?.sources ?? []) {
    const prior = sourcesByUrl.get(source.sourceUrl)
    if (!prior || (!prior.attribution && source.attribution)) sourcesByUrl.set(source.sourceUrl, source)
  }
  const sources = [...sourcesByUrl.values()]
  const topicLabels = response?.coveredTopics?.map(topic => TOPIC_LABELS[topic]).filter(Boolean) ?? []

  return (
    <section className="plant-assistant" aria-label="Plant assistant">
      {!open ? <button type="button" className="plant-assistant__primary" onClick={() => setOpen(true)}>
        Ask about this plant
      </button> : <>
        <div className="plant-assistant__heading">
          <h2 ref={heading} tabIndex={-1}>Ask about this plant</h2>
          <button type="button" className="plant-assistant__close" onClick={() => setOpen(false)} aria-label="Close plant assistant">Close</button>
        </div>
        {!supported ? <p role="status">We couldn’t identify this as one of the supported plant categories, so species-specific assistant guidance is unavailable. Try another scan or browse the catalogue.</p> : <>
          <p className="plant-assistant__intro">Answers about <em>{species!.scientific_name}</em> come from approved sources only. They explain your scan result; they don’t re-identify the plant.</p>
          <div className="plant-assistant__suggestions" role="group" aria-label="Suggested plant questions">
            {suggestionsFor(species!.species_id).map(text => <button key={text} type="button" disabled={pending} onClick={() => void submitQuestion(text)}>{text}</button>)}
          </div>
          <form onSubmit={submit}>
            <label htmlFor="plant-question">Your question</label>
            <textarea id="plant-question" value={question} maxLength={600} rows={2} disabled={pending}
              aria-describedby="plant-question-hint"
              onChange={event => { setQuestion(event.target.value); setRepeat(null) }} />
            <p id="plant-question-hint" className="plant-assistant__hint">English only. Leave out personal details, locations and access codes. This conversation clears when you leave this scan.</p>
            <button className="plant-assistant__primary" type="submit" disabled={pending || !question.trim()}>
              {pending ? 'Checking the approved information…' : 'Ask question'}
            </button>
          </form>
          {repeat && <div className="plant-assistant__repeat" role="status">
            <p>I explained this question earlier in this conversation. Would you like a simpler or more detailed explanation?</p>
            <div className="plant-assistant__choices">
              <button type="button" aria-label="Simpler explanation" disabled={pending} onClick={() => void submitQuestion(repeat, 'simpler', false)}>Simpler</button>
              <button type="button" disabled={pending} onClick={() => void submitQuestion(repeat, 'detailed', false)}>More detail</button>
            </div>
          </div>}
          {pending && <p className="sr-only" role="status">Checking the approved information…</p>}
          {error && <p role="alert">{error}</p>}
          <div aria-live="polite">
          {response && !pending && !repeat && <div className="plant-assistant__response">
            <p className="plant-assistant__asked">{responseQuestion}</p>
            <h3 ref={responseHeading} tabIndex={-1}>{response.status === 'fallback' ? 'Source information' : response.status === 'answer' ? 'Answer' : 'Evidence is insufficient'}</h3>
            {unchangedDepth && <p className="plant-assistant__notice" role="status">
              {unchangedDepth === 'simpler'
                ? 'This is already the shortest approved wording for this answer.'
                : 'The approved sources have no further detail for this answer.'}
            </p>}
            <p className="plant-assistant__answer">{response.answer}</p>
            {response.status === 'insufficient_evidence' && topicLabels.length > 0 &&
              <p className="plant-assistant__coverage">Available information for this species: {topicLabels.join(', ')}.</p>}
            {response.answerability === 'answerable' && <div className="plant-assistant__levels" role="group" aria-label="Explanation level">
              {DEPTHS.map(({ depth, label, ariaLabel }) => <button key={depth} type="button" aria-label={ariaLabel}
                aria-pressed={responseDepth === depth} disabled={pending}
                onClick={() => { if (depth !== responseDepth) void submitQuestion(responseQuestion, depth, false) }}>{label}</button>)}
            </div>}
            {sources.length > 0 && <>
              <h3>{response.answerability === 'answerable' ? 'Sources' : 'Related sources'}</h3>
              {response.answerability !== 'answerable' && <p className="plant-assistant__hint">These sources cover this plant but do not answer your question.</p>}
              <ul>{sources.map(source => <li key={source.sourceUrl}>
                <a href={source.sourceUrl} target="_blank" rel="noopener noreferrer">{source.sourceName}</a>
                {source.attribution && <span> — {source.attribution}</span>}
                {source.sourceLicense && source.sourceLicenseUrl && <span> (<a href={source.sourceLicenseUrl}
                  target="_blank" rel="noopener noreferrer">{source.sourceLicense}</a>)</span>}
              </li>)}</ul>
            </>}
            <p className="plant-assistant__safety">{response.safetyBoundary}</p>
          </div>}
          </div>
        </>}
      </>}
    </section>
  )
}
