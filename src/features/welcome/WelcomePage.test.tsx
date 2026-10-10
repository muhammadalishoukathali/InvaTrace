import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { WelcomePage } from './WelcomePage'
import { EXAMPLE_STATUS, FACT_SOURCES, FEATURES, HERO_PHOTO_CREDIT, INVASIVE_PLANT, SDG, STEPS } from './welcome-content'

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
    const starts = (html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? []).filter((button) => button.includes('Start privately'))
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

  it('keeps the header to the logo, with restore access beside the first Start privately', () => {
    const header = html.slice(html.indexOf('welcome-nav'), html.indexOf('welcome-hero__content'))
    expect(header).toContain('InvaTrace')
    expect(header).not.toContain('Start privately')
    expect(header).not.toContain('How it works')
    expect(html).toContain('Already use InvaTrace? Restore access')
  })

  it('credits every photo and names the status source of the example plant', () => {
    const hero = html.slice(0, html.indexOf('</header>'))
    expect(hero).toContain(HERO_PHOTO_CREDIT.location)
    expect(hero).toContain(HERO_PHOTO_CREDIT.author)
    expect(hero).toContain(EXAMPLE_STATUS.label)
    expect(hero).toContain(`href="${EXAMPLE_STATUS.href}"`)
    expect(html).toContain(INVASIVE_PLANT.credit.author)
    expect(html).toContain(`href="${INVASIVE_PLANT.credit.href}"`)
  })

  it('shows the original reservoir comparison before and after control', () => {
    expect(INVASIVE_PLANT.photos).toHaveLength(2)
    for (const shot of INVASIVE_PLANT.photos) {
      expect(html).toContain(shot.src)
      expect(html).toContain(shot.label)
    }
    expect(html.indexOf(INVASIVE_PLANT.photos[0].src)).toBeLessThan(html.indexOf(INVASIVE_PLANT.photos[1].src))
    expect(html).toContain(`href="${INVASIVE_PLANT.caseSource.href}"`)
    expect(html).toContain('open water had returned by 2021')
    expect(html).not.toContain('Tungog Lake')
    expect(html).toContain('Las Curias')
  })

  it('explains what an invasive plant is and shows the three main features', () => {
    expect(html).toContain('What is an invasive plant?')
    expect(html).toContain(INVASIVE_PLANT.definition)
    expect(FEATURES.map((feature) => feature.title)).toEqual(
      ['Scan and report', 'Learn how to prevent and stop spread', 'Work together as a community'],
    )
    for (const feature of FEATURES) expect(html).toContain(`<h3>${feature.title}</h3>`)
    for (const row of ['Know what to look for', 'See what changes']) expect(html).toContain(`<h3>${row}</h3>`)
  })

  it('does not promise outcomes or publish unverified figures', () => {
    expect(html).not.toMatch(/guarantee|100%|accura|Upcoming/i)
    expect(html).toContain('not expert confirmation')
  })
})
