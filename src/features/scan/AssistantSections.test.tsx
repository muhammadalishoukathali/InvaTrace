import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AssistantSections, PlantAssistantPanel, assistantRequestFor, type AssistantResponse } from './PlantAssistantPanel'

const source = { chunkId: 'stored', sourceName: 'Reviewed publisher', sourceUrl: 'https://reviewed.example.org', jurisdiction: 'global', attribution: 'Publisher credit' }
const base: AssistantResponse = { status: 'answer', answerability: 'answerable', answer: 'Compatibility summary', safetyBoundary: 'Boundary', answerMode: 'grounded', sources: [source] }
const warning = "This information was generated using AI knowledge and has not been verified against InvaTrace's reviewed sources. It may contain inaccuracies."

describe('section-aware assistant rendering', () => {
  it('describes hybrid conversation and all explanation levels in the help', () => {
    const markup = renderToStaticMarkup(<PlantAssistantPanel initiallyOpen
      guideContext={{ speciesId: 'arachis-pintoi', scientificName: 'Arachis pintoi' }} />)
    expect(markup).toContain('another plant or a botanical concept')
    expect(markup).toContain('Both support Simpler, Standard and More detail')
    expect(markup).not.toContain('mixed answers can use Detailed for reviewed content')
  })
  it('keeps the AI notice compact and the full disclosure collapsed', () => {
    const markup = renderToStaticMarkup(<AssistantSections response={{ ...base, sections: [
      { kind: 'ai', title: 'AI knowledge', answer: 'A botanical explanation.', warning, sources: [], depth: 'detailed' },
    ] }} />)
    expect(markup).toContain('AI knowledge · may be inaccurate')
    expect(markup).toContain('<details class="plant-assistant__ai-disclosure">')
    expect(markup).not.toContain('<details open')
    expect(markup).not.toContain('class="plant-assistant__notice"')
    expect(markup).toContain(warning.replaceAll("'", '&#x27;'))
  })
  it('explains an unavailable AI rewrite instead of implying no further source detail', () => {
    const markup = renderToStaticMarkup(<AssistantSections response={{ ...base, status: 'fallback', intent: 'botanical', sections: [
      { kind: 'grounded', title: 'From reviewed sources', answer: 'Reviewed text', sources: [source], depth: 'detailed' },
    ] }} />)
    expect(markup).toContain('AI explanation was unavailable or failed its evidence check')
    expect(markup).toContain('Reviewed text')
    expect(markup).not.toContain('no further detail')
  })

  it('explains preserved safety wording without suggesting a provider failure', () => {
    const markup = renderToStaticMarkup(<AssistantSections response={{ ...base, status: 'fallback', intent: 'restricted', sections: [
      { kind: 'grounded', title: 'From reviewed sources', answer: 'Reviewed safety text', sources: [source], depth: 'simpler' },
    ] }} />)
    expect(markup).toContain('guidance rewrite was unavailable or failed its preservation check')
    expect(markup).not.toContain('AI explanation was unavailable')
  })

  it('keeps genuine links exclusively inside the reviewed section', () => {
    const markup = renderToStaticMarkup(<AssistantSections response={{ ...base, sections: [
      { kind: 'grounded', title: 'From reviewed sources', answer: 'Reviewed plant fact.', sources: [source], depth: 'detailed' },
      { kind: 'ai', title: 'Additional AI-generated information', answer: 'Unverified plant education.', warning, sources: [], depth: 'standard' },
    ], mixedDepthNotice: 'Reviewed content uses Detailed; additional AI-generated information uses Standard.' }} />)
    const aiIndex = markup.indexOf('data-section-kind="ai"')
    expect(markup.slice(0, aiIndex)).toContain('https://reviewed.example.org')
    expect(markup.slice(aiIndex)).not.toContain('<a ')
    expect(markup).toContain('From reviewed sources')
    expect(markup).toContain('Additional AI-generated information')
    expect(markup).toContain('may contain inaccuracies')
    expect(markup).toContain('Publisher credit')
    expect(markup).toContain('data-section-depth="standard"')
  })

  it('ignores citations accidentally attached to an AI section and supplies the warning', () => {
    const markup = renderToStaticMarkup(<AssistantSections response={{ ...base, answerMode: 'general_knowledge', sections: [
      { kind: 'ai', title: 'Additional AI-generated information', answer: 'AI information', sources: [source], depth: 'standard' },
    ] }} />)
    expect(markup).not.toContain('<a ')
    expect(markup).toContain('may contain inaccuracies')
  })

  it('preserves a reviewed answer when additional information is unavailable', () => {
    const markup = renderToStaticMarkup(<AssistantSections response={{ ...base, sections: [
      { kind: 'grounded', title: 'From reviewed sources', answer: 'Valid reviewed text', sources: [source], depth: 'standard' },
      { kind: 'unavailable', title: 'Additional information unavailable', answer: 'Could not validate AI information', sources: [], depth: 'standard' },
    ] }} />)
    expect(markup).toContain('Valid reviewed text')
    expect(markup).toContain('Could not validate AI information')
    expect(markup.match(/https:\/\/reviewed.example.org/g)).toHaveLength(1)
  })

  it('renders natural conversational replies without source links', () => {
    const markup = renderToStaticMarkup(<AssistantSections response={{ ...base, sources: [], sections: [
      { kind: 'conversation', title: 'Plant conversation', answer: 'Hello! Ask about plants.', sources: [], depth: 'standard' },
    ] }} />)
    expect(markup).toContain('Hello! Ask about plants.')
    expect(markup).not.toContain('<a ')
  })

  it('opts every entry point into the section-aware contract', () => {
    const contexts = [
      { guideContext: { speciesId: 'mikania-micrantha', scientificName: 'Mikania micrantha' } },
      { mapContext: { sightingId: 'public', speciesId: 'mikania-micrantha', scientificName: 'Mikania micrantha' } },
      { result: { outcome: 'target' as const, speciesId: 'mikania-micrantha', confidence: .95, modelVersion: 'test', reportable: true } },
    ]
    for (const context of contexts) expect(assistantRequestFor(context, 'Hello', 'standard').body.sectionAware).toBe(true)
  })
})
