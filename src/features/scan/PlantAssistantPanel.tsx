import { PlantLoader } from '@/components/PlantLoader'
import { useEffect, useRef, useState, type FormEvent, type Ref } from 'react'
import { ArrowUp, BookOpen, ExternalLink, Info, Leaf, MessageCircle, ShieldCheck, Sprout, Trees, Wind, X } from 'lucide-react'
import type { IdentifyResult } from '@/types'
import { api, ApiError } from '@/services/api-client'
import { findApprovedSpecies } from '@shared/catalogue'
import './plant-assistant.css'

export interface AssistantResponse {
  status: 'answer' | 'fallback' | 'insufficient_evidence' | 'unsupported_scan'
  answerability: 'answerable' | 'insufficient_evidence'
  answer: string
  safetyBoundary: string
  coveredTopics?: string[]
  answerMode?: 'grounded' | 'general_knowledge' | 'fallback'
  coverage?: 'fully_supported' | 'partially_supported' | 'unsupported' | 'uncertain'
  intent?: 'botanical' | 'catalogue' | 'greeting' | 'off_topic' | 'ambiguous' | 'restricted'
  sections?: AnswerSection[]
  mixedDepthNotice?: string | null
  sources: Array<{ chunkId: string; sourceName: string; sourceUrl: string; jurisdiction: string;
    attribution?: string | null; sourceLicense?: string | null; sourceLicenseUrl?: string | null }>
}

export type AnswerSection = {
  kind: 'grounded' | 'ai' | 'conversation' | 'unavailable'
  title: string
  answer: string
  depth: Depth
  sources: AssistantResponse['sources']
  warning?: string | null
}

function ReviewedSources({ sources }: { sources: AssistantResponse['sources'] }) {
  const unique = [...new Map(sources.map(source => [source.sourceUrl, source])).values()]
  return unique.length > 0 && <section className="plant-assistant__sources" aria-label="Sources">
    <h4>Sources</h4>
    <ul>{unique.map(source => <li key={source.sourceUrl}>
      <a className="plant-assistant__source-link" href={source.sourceUrl} target="_blank" rel="noopener noreferrer">
        <span>{source.sourceName}</span><ExternalLink size={14} aria-hidden="true" />
      </a>
      {source.attribution && <p className="plant-assistant__source-meta">{source.attribution}</p>}
      {source.sourceLicense && source.sourceLicenseUrl && <p className="plant-assistant__source-meta">
        <a href={source.sourceLicenseUrl} target="_blank" rel="noopener noreferrer">{source.sourceLicense}</a>
      </p>}
    </li>)}</ul>
  </section>
}

export function AssistantSections({ response }: { response: AssistantResponse }) {
  return <>
    {response.status === 'fallback' && response.intent !== 'restricted' && <p className="plant-assistant__notice" role="status">The AI explanation was unavailable or failed its evidence check. Reviewed source text is shown instead.</p>}
    {response.intent === 'restricted' && response.status === 'fallback' && response.answerability === 'answerable' && <p className="plant-assistant__notice">The guidance rewrite was unavailable or failed its preservation check. Reviewed wording is shown instead.</p>}
    {response.mixedDepthNotice && <p className="plant-assistant__notice">{response.mixedDepthNotice}</p>}
    {response.sections?.map((section, index) => <section key={index}
      className={`plant-assistant__answer-section plant-assistant__answer-section--${section.kind}`}
      aria-label={section.title} data-section-kind={section.kind} data-section-depth={section.depth}>
      {section.kind !== 'ai' && <h4>{section.title}</h4>}
      {section.kind === 'ai' && <details className="plant-assistant__ai-disclosure">
        <summary><Info size={13} aria-hidden="true" /> AI knowledge · may be inaccurate</summary>
        <p>{section.warning || "This information was generated using AI knowledge and has not been verified against InvaTrace's reviewed sources. It may contain inaccuracies."}</p>
      </details>}
      <p className="plant-assistant__answer">{section.answer}</p>
      {section.kind === 'grounded' && <ReviewedSources sources={section.sources} />}
    </section>)}
  </>
}

const TOPIC_LABELS: Record<string, string> = {
  identification: 'Identification', habitat: 'Habitat', impact: 'Impact',
  spread: 'Spread pathways', safe_response: 'Safe response', documented_hazards: 'Documented hazards',
  names_status: 'Names and status', origin: 'Origin', life_cycle: 'Life cycle',
}

export type Depth = 'standard' | 'simpler' | 'detailed'
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
const SUGGESTION_ICONS = [Leaf, Trees, Sprout, Wind, ShieldCheck]
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

export type AssistantContextProps =
  | { result: IdentifyResult; mapContext?: never; guideContext?: never; initiallyOpen?: boolean; onClose?: () => void }
  | { result?: never; mapContext: { sightingId: string; speciesId: string; scientificName: string }; guideContext?: never; initiallyOpen?: boolean; onClose?: () => void }

  | { result?: never; mapContext?: never; guideContext: { speciesId: string; scientificName: string }; initiallyOpen?: boolean; onClose?: () => void }

export function assistantRequestFor(context: AssistantContextProps, question: string, depth: Depth) {
  if (context.mapContext) return {
    path: '/api/v1/plant-assistant/map/ask',
    body: { sightingId: context.mapContext.sightingId, question, depth, allowGeneralKnowledge: true, sectionAware: true },
  }
  if (context.guideContext) return {
    path: '/api/v1/plant-assistant/guide/ask',
    body: { speciesId: context.guideContext.speciesId, question, depth, allowGeneralKnowledge: true, sectionAware: true },
  }
  const species = assistantSpeciesForScan(context.result)
  return {
    path: '/api/v1/plant-assistant/ask',
    body: { speciesId: species?.species_id ?? null, classifierConfidence: context.result.confidence,
      classifierOutcome: context.result.outcome, question, depth, allowGeneralKnowledge: true, sectionAware: true },
  }
}

interface AssistantTurn {
  id: number
  question: string
  depth: Depth
  response: AssistantResponse
  unchangedDepth: Depth | null
}

export function PlantAssistantHeader({ context, speciesName, onClose, headingRef }: {
  context: string; speciesName?: string; onClose: () => void; headingRef?: Ref<HTMLHeadingElement>
}) {
  return <div className="plant-assistant__heading">
    <div className="plant-assistant__identity">
      <span className="plant-assistant__mark"><Leaf size={24} aria-hidden="true" /></span>
      <div>
        <h2 ref={headingRef} tabIndex={-1}>Plant Assistant</h2>
        <div className="plant-assistant__subtitle">
          {speciesName && <em className="plant-assistant__species-name">{speciesName}</em>}
          <p className="plant-assistant__context">{context}</p>
        </div>
      </div>
    </div>
    <button type="button" className="plant-assistant__close" onClick={onClose}
      aria-label="Close plant assistant"><X size={16} aria-hidden="true" /><span>Close</span></button>
  </div>
}

function AssistantTurnView({ turn, latest, pending, repeat, contextDescription, headingRef, onDepthChange }: {
  turn: AssistantTurn; latest: boolean; pending: boolean; repeat: boolean; contextDescription: string;
  headingRef?: Ref<HTMLHeadingElement>; onDepthChange: (depth: Depth) => void
}) {
  const { response, question, depth, unchangedDepth } = turn
  const sourcesByUrl = new Map<string, AssistantResponse['sources'][number]>()
  for (const source of response.sources) {
    const prior = sourcesByUrl.get(source.sourceUrl)
    if (!prior || (!prior.attribution && source.attribution)) sourcesByUrl.set(source.sourceUrl, source)
  }
  const sources = [...sourcesByUrl.values()]
  const topicLabels = response.coveredTopics?.map(topic => TOPIC_LABELS[topic]).filter(Boolean) ?? []
  return <article className={`plant-assistant__turn${latest ? ' plant-assistant__response' : ''}`}
    data-turn-id={turn.id} data-depth={depth}
    data-mode={response.answerMode === 'general_knowledge' ? 'general' : response.status === 'answer' ? 'grounded' : response.status === 'fallback' ? 'fallback' : 'limitation'}>
    <div className="plant-assistant__question">
      <span>Your question</span>
      <p className="plant-assistant__asked">{question}</p>
    </div>
    <div className="plant-assistant__reply">
      <h3 ref={headingRef} tabIndex={-1}>
        {response.answerMode === 'general_knowledge' || response.answerability !== 'answerable'
          ? <Info size={18} aria-hidden="true" /> : <BookOpen size={18} aria-hidden="true" />}
        {response.intent === 'greeting' || response.intent === 'off_topic' || response.intent === 'ambiguous' ? 'Plant conversation' : response.answerMode === 'general_knowledge' ? 'General botanical information' : response.status === 'fallback' ? 'Source information' : response.status === 'answer' ? 'Answer' : 'Evidence is insufficient'}
      </h3>
      {!response.sections?.length && response.answerMode === 'general_knowledge' && <p className="plant-assistant__notice">This explanation uses general model knowledge. It has not been verified against InvaTrace sources and makes no claim about the plant {contextDescription}.</p>}
      {unchangedDepth && response.status !== 'fallback' && <p className="plant-assistant__notice" role={latest ? 'status' : undefined}>
        {response.answerMode === 'general_knowledge'
          ? 'The explanation is unchanged at this level.'
          : 'The generated explanation did not change at this level.'}
      </p>}
      {response.sections?.length ? <AssistantSections response={response} /> : <p className="plant-assistant__answer">{response.answer}</p>}
      {response.status === 'insufficient_evidence' && topicLabels.length > 0 &&
        <p className="plant-assistant__coverage">Available information for this species: {topicLabels.join(', ')}.</p>}
      {response.answerability === 'answerable' && (latest && !repeat ? <div className="plant-assistant__depth">
        <p>Explanation level</p>
        <div className="plant-assistant__levels" role="group" aria-label="Explanation level">
          {DEPTHS.map(({ depth: nextDepth, label, ariaLabel }) => <button key={nextDepth} type="button" aria-label={ariaLabel}
            aria-pressed={depth === nextDepth} disabled={pending}
            onClick={() => { if (nextDepth !== depth) onDepthChange(nextDepth) }}>{label}</button>)}
        </div>
      </div> : <p className="plant-assistant__past-depth">Explanation level: {DEPTHS.find(item => item.depth === depth)?.label}</p>)}
      {!response.sections?.length && response.answerMode !== 'general_knowledge' && sources.length > 0 && <section className="plant-assistant__sources" aria-label={response.answerability === 'answerable' ? 'Sources' : 'Related sources'}>
        <h3>{response.answerability === 'answerable' ? 'Sources' : 'Related sources'}</h3>
        {response.answerability !== 'answerable' && <p className="plant-assistant__hint">These sources cover this plant but do not answer your question.</p>}
        <ul>{sources.map(source => <li key={source.sourceUrl}>
          <a className="plant-assistant__source-link" href={source.sourceUrl} target="_blank" rel="noopener noreferrer">
            <span>{source.sourceName}</span><ExternalLink size={14} aria-hidden="true" />
          </a>
          {(source.attribution || (source.sourceLicense && source.sourceLicenseUrl)) && <p className="plant-assistant__source-meta">
            {source.attribution && <span>{source.attribution}</span>}
            {source.sourceLicense && source.sourceLicenseUrl && <span> (<a href={source.sourceLicenseUrl}
              target="_blank" rel="noopener noreferrer">{source.sourceLicense}</a>)</span>}
          </p>}
        </li>)}</ul>
      </section>}
      <p className="plant-assistant__safety"><ShieldCheck size={18} aria-hidden="true" /><span>{response.safetyBoundary}</span></p>
    </div>
  </article>
}

export function PlantAssistantPanel(props: AssistantContextProps) {
  const contextKey = props.mapContext
    ? `map:${props.mapContext.sightingId}:${props.mapContext.speciesId}:${props.mapContext.scientificName}`
    : props.guideContext
      ? `guide:${props.guideContext.speciesId}:${props.guideContext.scientificName}`
      : `scan:${props.result.speciesId}:${props.result.scientificName}:${props.result.outcome}:${props.result.confidence}`
  return <PlantAssistantConversation key={contextKey} {...props} />
}

function PlantAssistantConversation(props: AssistantContextProps) {
  const { result, mapContext, guideContext, onClose } = props
  const [open, setOpen] = useState(props.initiallyOpen ?? false)
  const [question, setQuestion] = useState('')
  const [turns, setTurns] = useState<AssistantTurn[]>([])
  const [pending, setPending] = useState(false)
  const [requestQuestion, setRequestQuestion] = useState('')
  const [repeat, setRepeat] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const standardAnswers = useRef(new Map<string, string>())
  const answered = useRef(new Map<string, AssistantResponse['answerMode']>())
  const nextTurnId = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const openButton = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)
  const errorMessage = useRef<HTMLParagraphElement>(null)
  const repeatMessage = useRef<HTMLDivElement>(null)
  const pendingMessage = useRef<HTMLDivElement>(null)
  const responseHeading = useRef<HTMLHeadingElement>(null)
  const revealResponse = useRef(false)
  const species = mapContext
    ? findApprovedSpecies({ speciesId: mapContext.speciesId, scientificName: mapContext.scientificName })
    : guideContext
      ? findApprovedSpecies({ speciesId: guideContext.speciesId, scientificName: guideContext.scientificName })
      : assistantSpeciesForScan(result!)
  const supported = Boolean(species)
  const latestTurn = turns.at(-1)
  const contextDescription = mapContext ? 'in this map record' : guideContext ? 'in a guide or observation' : 'in your scan'

  useEffect(() => () => { controller.current?.abort(); controller.current = null }, [])
  useEffect(() => {
    if (open) heading.current?.focus()
    else if (wasOpen.current) openButton.current?.focus()
    wasOpen.current = open
  }, [open])
  useEffect(() => {
    if (error) errorMessage.current?.scrollIntoView?.({ block: 'nearest' })
  }, [error])
  useEffect(() => {
    if (repeat) repeatMessage.current?.scrollIntoView?.({ block: 'nearest' })
    if (pending) pendingMessage.current?.scrollIntoView?.({ block: 'nearest' })
  }, [repeat, pending])
  useEffect(() => {
    if (!latestTurn || pending || !revealResponse.current) return
    revealResponse.current = false
    const target = responseHeading.current
    if (!target) return
    target.focus({ preventScroll: true })
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    target.closest('.plant-assistant__turn')?.scrollIntoView?.({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' })
  }, [latestTurn, pending])

  const closeAssistant = () => {
    controller.current?.abort()
    controller.current = null
    revealResponse.current = false
    setOpen(false)
    setQuestion('')
    setTurns([])
    setPending(false)
    setRequestQuestion('')
    setRepeat(null)
    setError(null)
    standardAnswers.current.clear()
    answered.current.clear()
    onClose?.()
  }

  const submitQuestion = async (text: string, depth: Depth = 'standard', clarify = true) => {
    const trimmed = text.trim()
    if (!trimmed || pending) return
    setError(null)
    if (clarify && answered.current.has(trimmed.toLowerCase())) {
      setRepeat(trimmed)
      return
    }
    setRepeat(null)
    setRequestQuestion(trimmed)
    setPending(true)
    const attempt = new AbortController()
    controller.current = attempt
    const timeout = window.setTimeout(() => attempt.abort(), 65_000)
    try {
      const payload = assistantRequestFor(props, trimmed, depth)
      const conversationHistory = turns.slice(-3).flatMap(turn => [
        { role: 'user' as const, content: turn.question.slice(0, 3000) },
        { role: 'assistant' as const, content: turn.response.answer.slice(0, 3000) },
      ])
      const previousAnswer = !clarify && latestTurn?.question.toLowerCase() === trimmed.toLowerCase()
        ? latestTurn.response.answer.slice(0, 4000) : undefined
      const next = await api<AssistantResponse>(payload.path, {
        method: 'POST', signal: attempt.signal, cache: 'no-store',
        body: JSON.stringify({ ...payload.body, history: conversationHistory, previousAnswer }),
      })
      if (attempt.signal.aborted) return
      const key = trimmed.toLowerCase()
      if (depth === 'standard') standardAnswers.current.set(key, next.answer)
      const unchangedDepth = depth !== 'standard' && standardAnswers.current.get(key) === next.answer ? depth : null
      const replacing = !clarify && latestTurn?.question.toLowerCase() === key
      const turn: AssistantTurn = { id: replacing ? latestTurn.id : ++nextTurnId.current, question: trimmed, depth, response: next, unchangedDepth }
      setTurns(previous => replacing ? [...previous.slice(0, -1), turn] : [...previous, turn])
      setQuestion('')
      setRequestQuestion('')
      revealResponse.current = true
      if (next.answerability === 'answerable') answered.current.set(key, next.answerMode)
    } catch (cause) {
      if (attempt.signal.aborted && controller.current !== attempt) return
      setError(cause instanceof ApiError && cause.status === 429
        ? 'You have asked several questions recently. Wait a minute, then try again.'
        : 'The assistant could not be reached. Check your connection and try again, or open the catalogue entry.')
    } finally {
      window.clearTimeout(timeout)
      if (controller.current === attempt) setPending(false)
    }
  }

  const submit = (event: FormEvent) => { event.preventDefault(); void submitQuestion(question) }
  const suggestions = <div className="plant-assistant__suggestions" role="group" aria-label="Suggested plant questions">
    {species && suggestionsFor(species.species_id).map(text => {
      const Icon = SUGGESTION_ICONS[SUGGESTIONS.indexOf(text)]
      return <button key={text} type="button" disabled={pending} onClick={() => void submitQuestion(text)}>
        <Icon size={16} aria-hidden="true" /><span>{text}</span>
      </button>
    })}
  </div>

  return <section className={`plant-assistant${open ? ' plant-assistant--open' : ''}${open && supported ? ' plant-assistant--supported' : ''}`} aria-label="Plant assistant">
    {!open ? <button ref={openButton} type="button" className="plant-assistant__primary" onClick={() => setOpen(true)}>
      <MessageCircle size={18} aria-hidden="true" />Ask about this plant
    </button> : <>
      <PlantAssistantHeader headingRef={heading} speciesName={species?.scientific_name}
        context={mapContext ? 'Public map record' : guideContext ? 'Plant guide' : 'Scan result'} onClose={closeAssistant} />
      {!supported ? <p className="plant-assistant__limitation" role="status">We couldn’t identify this as one of the supported plant categories, so species-specific assistant guidance is unavailable. Try another scan or browse the catalogue.</p> : <>
        <div className={`plant-assistant__conversation${turns.length === 0 && !pending && !error ? ' plant-assistant__conversation--empty' : ''}`} aria-label="Current plant conversation">
          <div className="plant-assistant__context-tools">
          {(mapContext || guideContext) && <p className="plant-assistant__context-boundary">{mapContext
            ? 'This is catalogue information for a public community record, not expert identification or proof of nearby presence.'
            : 'This is catalogue education, not identification or verification of an observed plant.'}</p>}
          <details className="plant-assistant__help">
            <summary>About this assistant</summary>
            <div className="plant-assistant__intro">
              <p>Ask about <em>{species!.scientific_name}</em>, another plant or a botanical concept. Answers can combine reviewed sources with clearly labelled AI knowledge. {mapContext && 'This is catalogue information for a public community record, not expert identification or proof of nearby presence.'} {guideContext && 'This is catalogue education, not identification or verification of an observed plant.'}</p>
              <p>Reviewed information has source citations. AI knowledge may be inaccurate, has no reviewed citations and does not change your plant identification. Both support Simpler, Standard and More detail. Brief answers, such as a plant name, may stay similar at different levels.</p>
            </div>
          </details>
          </div>
          {turns.length === 0 ? <div className="plant-assistant__empty">
            <p className="plant-assistant__welcome">Choose a suggested question or write your own.</p>
            {suggestions}
          </div> : <details className="plant-assistant__more-suggestions"><summary>Suggested questions</summary>{suggestions}</details>}
          <div className="plant-assistant__messages" role="log" aria-label="Plant questions and answers" aria-live="polite" aria-relevant="additions text" aria-busy={pending}>
            {turns.map((turn, index) => <AssistantTurnView key={turn.id} turn={turn} latest={index === turns.length - 1}
              pending={pending} repeat={Boolean(repeat)} contextDescription={contextDescription}
              headingRef={index === turns.length - 1 ? responseHeading : undefined}
              onDepthChange={depth => void submitQuestion(turn.question, depth, false)} />)}
          </div>
          {repeat && <div ref={repeatMessage} className="plant-assistant__repeat" role="status">
            <p>I explained this question earlier in this conversation. Would you like a simpler or more detailed explanation?</p>
            <div className="plant-assistant__choices">
              <button type="button" aria-label="Simpler explanation" disabled={pending} onClick={() => void submitQuestion(repeat, 'simpler', false)}>Simpler</button>
              <button type="button" disabled={pending} onClick={() => void submitQuestion(repeat, 'detailed', false)}>More detail</button>
            </div>
          </div>}
          {(pending || error) && <div className="plant-assistant__request">
            <div className="plant-assistant__question"><span>Your question</span><p className="plant-assistant__asked">{requestQuestion}</p></div>
            {pending && <div ref={pendingMessage} className="plant-assistant__thinking" role="status">
              <PlantLoader label="Preparing your answer…" />
            </div>}
            {error && <p ref={errorMessage} className="plant-assistant__error" role="alert">{error}</p>}
          </div>}
        </div>
        <form className="plant-assistant__composer" onSubmit={submit}>
          <label className="plant-assistant__input-label" htmlFor="plant-question">Your question</label>
          <div className="plant-assistant__compose-row">
            <textarea id="plant-question" value={question} maxLength={600} rows={2} disabled={pending}
              aria-describedby="plant-question-hint" placeholder="Ask about this plant or a general plant concept…"
              onChange={event => { setQuestion(event.target.value); setRepeat(null) }} />
            <button className="plant-assistant__primary" type="submit" disabled={pending || !question.trim()}
              aria-label={pending ? 'Preparing your answer…' : 'Ask question'}>
              <span className="plant-assistant__send-label">{pending ? 'Preparing your answer…' : 'Ask question'}</span>
              {pending ? <PlantLoader compact label="Preparing your answer…" /> : <ArrowUp size={18} aria-hidden="true" />}
            </button>
          </div>
          <p id="plant-question-hint" className="plant-assistant__hint">English only. Leave out personal details, locations and access codes. This conversation clears when you leave this {mapContext ? 'map record' : guideContext ? 'guide' : 'scan'}.</p>
        </form>
      </>}
    </>}
  </section>
}
