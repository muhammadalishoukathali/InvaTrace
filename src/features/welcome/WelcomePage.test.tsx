import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { WelcomePage } from './WelcomePage'
import { FACT_SOURCES, SDG, STEPS } from './welcome-content'

// React Router's <Link> logs a useLayoutEffect notice when rendered to a
// string. It is harmless here, so only that one message is filtered out.
const realError = console.error
const quiet = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  if (!String(args[0]).includes('useLayoutEffect')) realError(...args)
})
const html = renderToStaticMarkup(<MemoryRouter><WelcomePage /></MemoryRouter>)
quiet.mockRestore()

describe('public welcome page', () => {
  it('names the product, its purpose and the Malaysian context', () => {
    expect(html).toContain('InvaTrace')
    expect(html).toContain('Spot invasive plants.')
    expect(html).toContain('Malaysia')
  })

  it('offers Start privately in the hero, after the problem and at the end', () => {
    const starts = html.match(/<a[^>]*href="\/private-access"[^>]*>Start privately<\/a>/g) ?? []
    expect(starts.length).toBeGreaterThanOrEqual(3)
    // The problem section's own action comes after its sources.
    const sources = html.indexOf('Sources:')
    const goal = html.indexOf('welcome-goal')
    const action = html.indexOf('Start privately', sources)
    expect(action).toBeGreaterThan(sources)
    expect(action).toBeLessThan(goal)
  })

  it('lists the five steps in order', () => {
    const positions = STEPS.map((step) => html.indexOf(`<h3>${step.title}</h3>`))
    expect(positions.every((position) => position > -1)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    expect(STEPS.map((step) => step.title)).toEqual(
      ['Discover what to look for', 'Identify a plant', 'Follow safe guidance', 'Report a sighting', 'Monitor places over time'],
    )
  })

  it('links every fact source by a readable name', () => {
    for (const source of FACT_SOURCES) {
      expect(html).toContain(`href="${source.href}"`)
      expect(html).toContain(source.label)
    }
  })

  it('names SDG 15 in the hero and links Target 15.8 to the UN source', () => {
    const hero = html.slice(0, html.indexOf('</header>'))
    expect(hero).toContain('Supporting SDG 15 · Life on Land')
    expect(html).toContain('Target 15.8')
    expect(html).toContain(`href="${SDG.href}"`)
  })

  it('does not promise outcomes or publish unverified figures', () => {
    expect(html).not.toMatch(/guarantee|100%|accura|Upcoming/i)
    expect(html).toContain('not expert confirmation')
  })
})
