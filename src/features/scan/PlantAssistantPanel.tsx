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
const SUGGESTIONS = [
  'What does this plant look like?',
  'Where does it grow?',
  'Why is it invasive?',
  'How does it spread?',
  'How should I respond safely?',
]

export function assistantSpeciesForScan(result: IdentifyResult) {
  if (result.outcome === 'other_plant' || result.outcome === 'uncertain') return null
  return findApprovedSpecies({ speciesId: result.speciesId, scientificName: result.scientificName })
}

export function PlantAssistantPanel({ result }: { result: IdentifyResult }) {
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [response, setResponse] = useState<AssistantResponse | null>(null)
  const [responseQuestion, setResponseQuestion] = useState('')
  const [pending, setPending] = useState(false)
  const [repeat, setRepeat] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const answered = useRef(new Set<string>())
  const controller = useRef<AbortController | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const species = assistantSpeciesForScan(result)
  const supported = Boolean(species)

  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => { if (open) heading.current?.focus() }, [open])

  const submitQuestion = async (text: string, depth: Depth = 'standard', clarify = true) => {
    const trimmed = text.trim()
    if (!trimmed || pending) return
    setQuestion(trimmed)
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
      setResponse(next)
      setResponseQuestion(trimmed)
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
          <button type="button" onClick={() => setOpen(false)} aria-label="Close plant assistant">Close</button>
        </div>
        {!supported ? <p role="status">We couldn’t identify this as one of the supported plant categories, so species-specific assistant guidance is unavailable. Try another scan or browse the catalogue.</p> : <>
          <p>Questions about <strong>{species!.scientific_name}</strong>, based on your scan and approved sources. The assistant explains the scan; it does not identify the plant.</p>
          <p className="plant-assistant__privacy">Use English and leave out personal details, coordinates and access codes. This conversation is temporary and clears when you leave this scan.</p>
          <div className="plant-assistant__suggestions" role="group" aria-label="Suggested plant questions">
            {SUGGESTIONS.map(text => <button key={text} type="button" disabled={pending} onClick={() => void submitQuestion(text)}>{text}</button>)}
          </div>
          <form onSubmit={submit}>
            <label htmlFor="plant-question">Your question</label>
            <textarea id="plant-question" value={question} maxLength={600} rows={3} disabled={pending}
              onChange={event => { setQuestion(event.target.value); setRepeat(null) }} />
            <button className="plant-assistant__primary" type="submit" disabled={pending || !question.trim()}>
              {pending ? 'Checking the approved information…' : 'Ask question'}
            </button>
          </form>
          {repeat && <div className="plant-assistant__repeat" role="status">
            <p>I explained this question earlier in this conversation. Would you like a simpler or more detailed explanation?</p>
            <div className="plant-assistant__choices">
              <button type="button" disabled={pending} onClick={() => void submitQuestion(repeat, 'simpler', false)}>Simpler explanation</button>
              <button type="button" disabled={pending} onClick={() => void submitQuestion(repeat, 'detailed', false)}>More detail</button>
            </div>
          </div>}
          {pending && <p role="status">Checking evidence for your question…</p>}
          {error && <p role="alert">{error}</p>}
          {response && !pending && !repeat && <div className="plant-assistant__response" aria-live="polite">
            <h3>{response.status === 'fallback' ? 'Source information' : response.status === 'answer' ? 'Answer' : 'Evidence is insufficient'}</h3>
            {response.status === 'fallback' && <p className="plant-assistant__notice">Here is the relevant approved source information.</p>}
            <p className="plant-assistant__answer">{response.answer}</p>
            {response.status === 'insufficient_evidence' && topicLabels.length > 0 &&
              <p className="plant-assistant__coverage">Available information for this species: {topicLabels.join(', ')}.</p>}
            {response.answerability === 'answerable' && <div className="plant-assistant__choices" role="group" aria-label="Explanation level">
              <button type="button" onClick={() => void submitQuestion(responseQuestion, 'simpler', false)}>Simpler explanation</button>
              <button type="button" onClick={() => void submitQuestion(responseQuestion, 'standard', false)}>Standard explanation</button>
              <button type="button" onClick={() => void submitQuestion(responseQuestion, 'detailed', false)}>More detail</button>
            </div>}
            {sources.length > 0 && <>
              <h3>{response.answerability === 'answerable' ? 'Sources' : 'Related sources — these do not answer the question'}</h3>
              <ul>{sources.map(source => <li key={source.sourceUrl}>
                <a href={source.sourceUrl} target="_blank" rel="noopener noreferrer">{source.sourceName}</a>
                {source.attribution && <span> — {source.attribution}</span>}
                {source.sourceLicense && source.sourceLicenseUrl && <span> (<a href={source.sourceLicenseUrl}
                  target="_blank" rel="noopener noreferrer">{source.sourceLicense}</a>)</span>}
              </li>)}</ul>
            </>}
            <p className="plant-assistant__safety">{response.safetyBoundary}</p>
          </div>}
        </>}
      </>}
    </section>
  )
}
