// Epic 5 (place-based discovery, catalogue, offline catalogue) acceptance
// criteria against the dev server with the MSW mocks.
//
// Place associations are computed by the server (PostGIS buffers, ranking), so
// the place tests here prove what the page does with an association response;
// the per-test notes say which server rule is left to the real-stack suite.
// The installed offline pack needs a production build and lives in
// e2e/pwa.spec.ts; only the offline messaging is checked here.
import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pinModelSpecies, scanPhoto, startPrivateAccess } from '../fixtures/app'

const BUKIT_KIARA = '10000000-0000-4000-8000-000000000001'
const TAMAN_TUGU_TRAIL = '10000000-0000-4000-8000-000000000002'
const KOTA_DAMANSARA = '10000000-0000-4000-8000-000000000003'

interface CatalogueSource { source_id: string; title: string; publisher: string; url: string }
interface ApprovedRecord {
  species_id: string
  scientific_name: string
  common_names: string[]
  evidence_source_ids: string[]
}
interface DetailRecord {
  species_id: string
  identifying_characteristics: string
  typical_habitat: string
  documented_impacts: string
  safe_response_guidance: string[]
  source_ids: Record<string, string[]>
  reviewed_at: string
  [key: string]: unknown
}
interface CatalogueAsset {
  species_id: string
  url: string
  creator: string
  licence: string
  source_title: string
  source_url_or_identifier: string
  reviewed_at: string
}

// The reviewed catalogue the app bundles; the pages are compared against it.
const catalogueFile = <T>(name: string) => JSON.parse(
  readFileSync(path.join(process.cwd(), 'shared/catalogue', name), 'utf8'),
) as T
const approved = catalogueFile<{
  catalogue_version: string
  reviewed_at: string
  records: ApprovedRecord[]
  sources: CatalogueSource[]
}>('approved-species.json')
const details = catalogueFile<{ records: DetailRecord[]; sources: CatalogueSource[] }>('catalogue-details.json')
const manifest = catalogueFile<{ last_reviewed: string; assets: CatalogueAsset[] }>('catalogue-manifest.json')

interface Evidence {
  types: string[]
  insideCount: number
  nearbyCount: number
  trailCount: number
  upstreamCount: number
  nearestDistanceM: number
  insideComponent: number
  proximityComponent: number
  recordCountComponent: number
  upstreamComponent: number
  rankScore: number
}
interface Association {
  speciesId: string
  scientificName: string
  commonNames: string[]
  malaysiaStatus: string
  imageUrl: string | null
  occurrenceCount: number
  mostRecentYear: number | null
  evidence: Evidence
  catalogueUrl: string
}
interface Associations {
  placeId: string
  placeName: string
  placeType: string
  occurrenceUpdatedAt: string | null
  processedDataVersions: string[]
  disclaimer: string
  truncated: boolean
  items: Association[]
}

const pathOf = (url: string) => new URL(url).pathname
const associationsPath = (placeId: string) => `/api/v1/places/${placeId}/plant-associations`

/** Same formatter the pages use (en-GB, medium), evaluated in the browser so the time zone matches. */
const mediumDate = (page: Page, iso: string) => page.evaluate(
  (value) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(new Date(value)),
  iso,
)

async function openPlace(page: Page, placeId: string) {
  const loaded = page.waitForResponse((response) => pathOf(response.url()) === associationsPath(placeId))
  await page.goto(`/places/${placeId}`)
  const associations = await (await loaded).json() as Associations
  await expect(page.locator('.place-detail')).toBeVisible()
  return associations
}

/** Replaces one place's association response on the next load. MSW answers
 *  these requests inside the page, so neither page.route nor context.route
 *  ever sees them; the page's own fetch is wrapped instead. */
async function stubAssociations(page: Page, placeId: string, body: Associations) {
  await page.addInitScript(({ target, payload }) => {
    const original = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (new URL(url, window.location.origin).pathname === target) {
        return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return original(input, init)
    }
  }, { target: associationsPath(placeId), payload: body })
}

const association = (speciesId: string, overrides: Partial<Association> & { evidence: Evidence }): Association => {
  const record = approved.records.find((item) => item.species_id === speciesId)!
  return {
    speciesId,
    scientificName: record.scientific_name,
    commonNames: record.common_names,
    malaysiaStatus: 'Present',
    imageUrl: null,
    occurrenceCount: 1,
    mostRecentYear: 2024,
    catalogueUrl: `/catalogue/${speciesId}`,
    ...overrides,
  }
}
const evidence = (overrides: Partial<Evidence>): Evidence => ({
  types: ['inside_boundary'],
  insideCount: 0,
  nearbyCount: 0,
  trailCount: 0,
  upstreamCount: 0,
  nearestDistanceM: 0,
  insideComponent: 0,
  proximityComponent: 0,
  recordCountComponent: 0,
  upstreamComponent: 0,
  rankScore: 0,
  ...overrides,
})

/** One association card's label/value rows as an object. */
const cardFacts = async (card: Locator) => Object.fromEntries(await card.locator('dl > div').evaluateAll((rows) => rows.map((row) => [
  row.querySelector('dt')?.textContent ?? '',
  row.querySelector('dd')?.textContent ?? '',
]))) as Record<string, string>

const imageLoaded = (image: Locator) => image.evaluate((node) => {
  const element = node as HTMLImageElement
  return element.decode().then(() => element.naturalWidth > 0, () => false)
})

/** Flips the app's connectivity signal without touching the dev server connection. */
async function installOnlineSwitch(page: Page) {
  await page.addInitScript(() => {
    const state = window as unknown as { __invatraceOnline?: boolean }
    state.__invatraceOnline ??= true
    Object.defineProperty(Navigator.prototype, 'onLine', {
      configurable: true,
      get() { return (window as unknown as { __invatraceOnline: boolean }).__invatraceOnline },
    })
  })
}
async function goOffline(page: Page) {
  await page.evaluate(() => {
    ;(window as unknown as { __invatraceOnline: boolean }).__invatraceOnline = false
    window.dispatchEvent(new Event('offline'))
  })
}
/** Client-side navigation through the History API, which the router listens
 *  to. (Importing the app's router module from the test can hand back a second
 *  module instance when the dev server has hot-updated a file.) */
async function navigateInApp(page: Page, destination: string) {
  await page.evaluate((target) => {
    window.history.pushState(null, '', target)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, destination)
}

test('AC 5.1.1 Supported place selection', async ({ page }) => {
  await startPrivateAccess(page)

  // From the discovery map: selecting a mapped park opens its place panel.
  const mapped = page.getByRole('region', { name: 'Mapped places in current view' })
  const bukitKiara = mapped.getByRole('button', { name: /Bukit Kiara.*View plants recorded nearby/ })
  await expect(bukitKiara).toBeAttached({ timeout: 10_000 })
  await bukitKiara.focus()
  await page.keyboard.press('Enter')
  const panel = page.getByRole('dialog', { name: 'Bukit Kiara place preview' })
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('heading', { name: 'Bukit Kiara' })).toBeVisible()
  await expect(panel.locator('.map-place-preview__type')).toHaveText('Park')
  await expect(panel).toContainText('OpenStreetMap development extract · geometry mock-osm-2026-09-01')
  const action = panel.getByRole('link', { name: 'View plants recorded nearby' })
  await expect(action).toHaveAttribute('href', `/places/${BUKIT_KIARA}`)

  // The action opens the place, served by GET /api/v1/places/{place_id}.
  const placeLoaded = page.waitForResponse((response) => pathOf(response.url()) === `/api/v1/places/${BUKIT_KIARA}`)
  await action.click()
  const placeResponse = await placeLoaded
  expect(placeResponse.status()).toBe(200)
  const place = await placeResponse.json() as Record<string, unknown>
  expect(place).toMatchObject({
    placeId: BUKIT_KIARA,
    displayName: 'Bukit Kiara',
    placeType: 'park',
    geometryStatus: 'available',
    source: 'OpenStreetMap development extract',
  })
  expect((place.geometry as { type: string }).type).toBe('Polygon')
  await expect(page).toHaveURL(new RegExp(`/places/${BUKIT_KIARA}$`))
  const detail = page.locator('.place-detail')
  await expect(detail.getByRole('heading', { level: 2, name: 'Bukit Kiara' })).toBeVisible()
  await expect(detail.locator('header p')).toHaveText('park · OpenStreetMap development extract · geometry mock-osm-2026-09-01')
  // The mapped boundary is drawn on its own map.
  await expect(page.getByLabel('Mapped geometry for Bukit Kiara').locator('canvas')).toBeVisible()

  // From place search: a forest, found by name, with the same action.
  await page.goto('/places')
  await page.getByPlaceholder('Search park, forest or woodland').fill('  kota damansara ')
  const results = page.locator('.places-list li')
  await expect(results).toHaveCount(1)
  await expect(results.locator('strong').first()).toHaveText('Kota Damansara Community Forest')
  await expect(results.locator('small')).toHaveText('forest')
  await expect(results.locator('.places-list__action')).toHaveText('View plants recorded nearby')
  // The place id is stable: the list, the link and the detail response agree.
  await expect(results.getByRole('link')).toHaveAttribute('href', `/places/${KOTA_DAMANSARA}`)
  const forestLoaded = page.waitForResponse((response) => pathOf(response.url()) === `/api/v1/places/${KOTA_DAMANSARA}`)
  await results.getByRole('link').click()
  expect(await (await forestLoaded).json()).toMatchObject({ placeId: KOTA_DAMANSARA, placeType: 'forest', geometryStatus: 'available' })
  await expect(page.getByRole('heading', { level: 2, name: 'Kota Damansara Community Forest' })).toBeVisible()
  await expect(page.getByLabel('Mapped geometry for Kota Damansara Community Forest').locator('canvas')).toBeVisible()

  // A trail's page renders its line geometry when opened by id. (That trails
  // are deliberately not listed is the next test.)
  const trailLoaded = page.waitForResponse((response) => pathOf(response.url()) === `/api/v1/places/${TAMAN_TUGU_TRAIL}`)
  await page.goto(`/places/${TAMAN_TUGU_TRAIL}`)
  expect(await (await trailLoaded).json()).toMatchObject({ placeId: TAMAN_TUGU_TRAIL, placeType: 'trail', geometry: { type: 'LineString' } })
  await expect(page.getByRole('heading', { level: 2, name: 'Taman Tugu Trail' })).toBeVisible()
  await expect(page.locator('.place-detail header p')).toContainText('trail ·')
  await expect(page.getByLabel('Mapped geometry for Taman Tugu Trail').locator('canvas')).toBeVisible()
})

test('AC 5.1.1 Supported place selection - trails are not listed but still open from their direct link', async ({ page }) => {
  await startPrivateAccess(page)

  // The discovery map lists parks, forests and woodlands in view - never the trail.
  const mapped = page.getByRole('region', { name: 'Mapped places in current view' })
  await expect(mapped.getByRole('button', { name: /Bukit Kiara/ })).toBeAttached({ timeout: 10_000 })
  // Widen the view until a place further out than the trail is listed, so the
  // trail's absence is not just the starting viewport.
  await page.evaluate(() => {
    (window as unknown as { __map: { fitBounds: (bounds: number[][], options: { duration: number }) => void } }).__map
      .fitBounds([[101.57, 3.11], [101.72, 3.19]], { duration: 0 })
  })
  await expect(mapped.getByRole('button', { name: /Taman Tasik Titiwangsa/ })).toBeAttached({ timeout: 10_000 })
  await expect(mapped.getByRole('button', { name: /Rimba Ilmu Woodland/ })).toBeAttached()
  await expect(mapped.getByRole('button', { name: /Taman Tugu/ })).toHaveCount(0)
  await expect(mapped.getByRole('button', { name: /trail/i })).toHaveCount(0)

  // Browse places: the API still returns the trail, the list does not show it...
  const listLoaded = page.waitForResponse((response) => pathOf(response.url()) === '/api/v1/places')
  await page.goto('/places')
  const listed = await (await listLoaded).json() as { items: Array<{ placeId: string; placeType: string }> }
  expect(listed.items.map((item) => item.placeId)).toContain(TAMAN_TUGU_TRAIL)
  const rows = page.locator('.places-list li')
  await expect(rows).toHaveCount(listed.items.filter((item) => item.placeType !== 'trail').length)
  await expect(page.locator(`.places-list a[href="/places/${TAMAN_TUGU_TRAIL}"]`)).toHaveCount(0)
  await expect(page.locator('.places-list small', { hasText: /trail/i })).toHaveCount(0)
  // ...including when it is searched for by name or by type.
  const search = page.getByPlaceholder('Search park, forest or woodland')
  for (const term of ['Taman Tugu Trail', 'tugu', 'trail']) {
    await search.fill(term)
    await expect(page.locator('.places-state')).toContainText('No mapped places match this search.')
    await expect(rows).toHaveCount(0)
  }
  // A woodland, by contrast, is found and offers the action.
  await search.fill('woodland')
  await expect(rows).toHaveCount(1)
  await expect(rows.locator('strong').first()).toHaveText('Rimba Ilmu Woodland')
  await expect(rows.locator('small')).toHaveText('wood')
  await expect(rows.locator('.places-list__action')).toHaveText('View plants recorded nearby')

  // The trail still opens from its direct link and shows its line geometry.
  const trailLoaded = page.waitForResponse((response) => pathOf(response.url()) === `/api/v1/places/${TAMAN_TUGU_TRAIL}`)
  await page.goto(`/places/${TAMAN_TUGU_TRAIL}`)
  const trail = await (await trailLoaded).json() as { placeType: string; geometry: { type: string; coordinates: number[][] } }
  expect(trail.placeType).toBe('trail')
  expect(trail.geometry.type).toBe('LineString')
  expect(trail.geometry.coordinates.length).toBeGreaterThan(1)
  await expect(page.getByRole('heading', { level: 2, name: 'Taman Tugu Trail' })).toBeVisible()
  await expect(page.locator('.place-detail header p')).toContainText('trail ·')
  await expect(page.getByLabel('Mapped geometry for Taman Tugu Trail').locator('canvas')).toBeVisible()
})

test('AC 5.1.2 Direct and nearby spatial association', async ({ page }) => {
  // Mock layer only: shows the page keeps inside, nearby and trail-buffer
  // evidence apart as the API labels it. Which records fall inside the polygon,
  // within 1,000 m of it, or within 750 m of a trail - and that the distance is
  // geodesic - is decided in PostGIS and needs the real stack.
  await startPrivateAccess(page)
  const park = await openPlace(page, BUKIT_KIARA)
  const cards = page.locator('.place-associations > li')
  await expect(cards).toHaveCount(park.items.length)

  // The mock's park carries one plant with both kinds of evidence and one with inside-only.
  const both = park.items.find((item) => item.evidence.types.includes('nearby_buffer'))!
  expect(both.evidence.types).toEqual(['inside_boundary', 'nearby_buffer'])
  expect(both.evidence.insideCount).toBeGreaterThan(0)
  expect(both.evidence.nearbyCount).toBeGreaterThan(0)
  expect(both.evidence.trailCount).toBe(0)
  const bothCard = cards.filter({ hasText: both.scientificName })
  expect((await cardFacts(bothCard)).Evidence).toBe('inside boundary · nearby mapped buffer')
  const insideOnly = park.items.find((item) => item.evidence.types.join() === 'inside_boundary')!
  expect((await cardFacts(cards.filter({ hasText: insideOnly.scientificName }))).Evidence).toBe('inside boundary')

  // A trail's evidence is its own kind, shown with its distance rather than as "inside".
  await stubAssociations(page, TAMAN_TUGU_TRAIL, {
    ...park,
    placeId: TAMAN_TUGU_TRAIL,
    placeName: 'Taman Tugu Trail',
    placeType: 'trail',
    items: [association('mikania-micrantha', {
      occurrenceCount: 2,
      evidence: evidence({ types: ['trail_buffer'], trailCount: 2, nearestDistanceM: 412.6, proximityComponent: 1.2, rankScore: 1.4 }),
    })],
  })
  await page.goto(`/places/${TAMAN_TUGU_TRAIL}`)
  await expect(page.getByRole('heading', { level: 2, name: 'Taman Tugu Trail' })).toBeVisible()
  await expect(cards).toHaveCount(1)
  const trailFacts = await cardFacts(cards.first())
  expect(trailFacts.Evidence).toBe('along trail buffer')
  expect(trailFacts['Closest evidence']).toBe('413 m')
})

test('AC 5.1.3 Association ranking', async ({ page }) => {
  // Mock layer only: the rank is computed server-side. This proves the response
  // carries the evidence types and components, that the page keeps the API's
  // descending order, and that no probability is shown. The ranking formula
  // itself needs the real stack.
  await startPrivateAccess(page)
  const park = await openPlace(page, BUKIT_KIARA)
  expect(park.items.length).toBeGreaterThan(1)
  for (const item of park.items) {
    expect(item.evidence.types.length).toBeGreaterThan(0)
    for (const component of ['insideComponent', 'proximityComponent', 'recordCountComponent', 'upstreamComponent', 'rankScore'] as const) {
      expect(typeof item.evidence[component]).toBe('number')
    }
  }
  const scores = park.items.map((item) => item.evidence.rankScore)
  expect(scores).toEqual([...scores].sort((left, right) => right - left))
  const names = page.locator('.place-associations > li h3')
  await expect(names).toHaveText(park.items.map((item) => item.scientificName))

  // Three results whose rank order is neither alphabetical nor by record count:
  // the page must show them exactly as ranked.
  const ranked = [
    association('mimosa-pigra', { occurrenceCount: 1, evidence: evidence({ insideCount: 1, insideComponent: 4, recordCountComponent: 0.1, rankScore: 4.1 }) }),
    association('chromolaena-odorata', { occurrenceCount: 9, evidence: evidence({ types: ['nearby_buffer'], nearbyCount: 9, nearestDistanceM: 150, proximityComponent: 1.7, recordCountComponent: 0.9, rankScore: 2.6 }) }),
    association('acacia-mangium', { occurrenceCount: 3, evidence: evidence({ types: ['nearby_buffer'], nearbyCount: 3, nearestDistanceM: 900, proximityComponent: 0.2, recordCountComponent: 0.3, rankScore: 0.5 }) }),
  ]
  await stubAssociations(page, KOTA_DAMANSARA, { ...park, placeId: KOTA_DAMANSARA, placeName: 'Kota Damansara Community Forest', placeType: 'forest', items: ranked })
  await page.goto(`/places/${KOTA_DAMANSARA}`)
  await expect(names).toHaveText(['Mimosa pigra', 'Chromolaena odorata', 'Acacia mangium'])

  // The ranking is never presented as a probability of current presence.
  const list = await page.locator('.place-associations').innerText()
  expect(list).not.toMatch(/%|probabilit|likelihood|likely|chance|confidence|rank score|\bscore\b/i)
  for (const score of ranked.map((item) => String(item.evidence.rankScore))) expect(list).not.toContain(score)
  await expect(page.locator('.place-detail footer')).toContainText('They are not probabilities and do not show current presence or absence.')
})

test('AC 5.1.4 Place result information', async ({ page }) => {
  await startPrivateAccess(page)
  const park = await openPlace(page, BUKIT_KIARA)
  expect(park.occurrenceUpdatedAt).toBeTruthy()
  const updated = await mediumDate(page, park.occurrenceUpdatedAt!)
  const cards = page.locator('.place-associations > li')
  await expect(cards).toHaveCount(park.items.length)

  for (const [index, item] of park.items.entries()) {
    const card = cards.nth(index)
    // Scientific and common name, and the Malaysian status.
    await expect(card.getByRole('heading', { level: 3 })).toHaveText(item.scientificName)
    await expect(card.locator('.place-associations__heading p')).toHaveText(`${item.commonNames.join(' · ')} · Present in Malaysia`)
    // Record count, most recent year, inside-area label, evidence kinds.
    const facts = await cardFacts(card)
    expect(facts['Historical records']).toBe(String(item.occurrenceCount))
    expect(facts['Most recent year']).toBe(String(item.mostRecentYear))
    expect(item.evidence.types).toContain('inside_boundary')
    expect(facts['Closest evidence']).toBe('Inside mapped area')
    expect(facts.Evidence.length).toBeGreaterThan(0)
    // Every card: the occurrence-data update date and the exact statement.
    await expect(card.locator('.place-associations__provenance')).toHaveText(
      `Historical observations do not guarantee current presence. Occurrence data updated ${updated}.`,
    )
    await expect(card.getByRole('link', { name: 'View catalogue entry' })).toHaveAttribute('href', `/catalogue/${item.speciesId}`)
  }
})

test('AC 5.1.4 Place result information - reference image, distance and direction-aware evidence', async ({ page }) => {
  // The mock's associations have no image, no distance-only result and no
  // upstream-waterway result, so a response in the real API's shape is supplied
  // (the API returns the catalogue's own /reference-images/... URL).
  await startPrivateAccess(page)
  const park = await openPlace(page, BUKIT_KIARA)
  const image = manifest.assets.find((asset) => asset.species_id === 'mikania-micrantha')!.url
  await stubAssociations(page, KOTA_DAMANSARA, {
    ...park,
    placeId: KOTA_DAMANSARA,
    placeName: 'Kota Damansara Community Forest',
    placeType: 'forest',
    items: [
      association('mikania-micrantha', {
        imageUrl: image,
        occurrenceCount: 6,
        mostRecentYear: 2025,
        evidence: evidence({ types: ['nearby_buffer', 'upstream'], nearbyCount: 4, upstreamCount: 2, nearestDistanceM: 311.6, proximityComponent: 1.4, upstreamComponent: 0.5, rankScore: 2.5 }),
      }),
      association('eichhornia-crassipes', {
        occurrenceCount: 1,
        mostRecentYear: null,
        evidence: evidence({ insideCount: 1, insideComponent: 4, rankScore: 4 }),
      }),
    ],
  })
  await page.goto(`/places/${KOTA_DAMANSARA}`)
  const cards = page.locator('.place-associations > li')
  await expect(cards).toHaveCount(2)

  const first = cards.first()
  const picture = first.getByRole('img', { name: 'Reference view of Mikania micrantha' })
  await expect(picture).toBeVisible()
  await expect(picture).toHaveAttribute('src', /^\/reference-images\/mikania_micrantha\.jpg/)
  expect(await imageLoaded(picture)).toBe(true)
  const facts = await cardFacts(first)
  // Not inside the area: the closest distance is shown instead of the inside label.
  expect(facts['Closest evidence']).toBe('312 m')
  // Direction-aware (upstream waterway) evidence is named when it applies...
  expect(facts.Evidence).toBe('nearby mapped buffer · Upstream waterway record')
  // ...and only then.
  const second = await cardFacts(cards.nth(1))
  expect(second.Evidence).toBe('inside boundary')
  expect(second['Closest evidence']).toBe('Inside mapped area')
  // A missing year is stated, not invented.
  expect(second['Most recent year']).toBe('Not recorded')
})

test('AC 5.1.5 No evidence response', async ({ page }) => {
  await startPrivateAccess(page)
  const forest = await openPlace(page, KOTA_DAMANSARA)
  expect(forest.items).toEqual([])

  const empty = page.locator('.place-detail .places-state')
  await expect(empty.locator('strong')).toHaveText('No qualifying historical records found')
  await expect(page.locator('.place-associations')).toHaveCount(0)
  // The catalogue stays one step away.
  const browse = empty.getByRole('link', { name: 'Browse the full catalogue' })
  await expect(browse).toHaveAttribute('href', '/catalogue')

  // No evidence is not a statement that the place has no invasive plants.
  const text = await page.locator('.place-detail').innerText()
  expect(text).not.toMatch(/no invasive (plants|species)|free (from|of) invasive|invasive[- ]free|clear of invasive|no invasive/i)
  await expect(empty).toContainText('Historical observations do not guarantee current presence.')

  await browse.click()
  await expect(page).toHaveURL(/\/catalogue$/)
  await expect(page.getByRole('list', { name: '32 catalogue plants' })).toBeVisible()
})

test('AC 5.2.1 Complete catalogue listing', async ({ page }) => {
  // The page reads the bundled catalogue (it must work offline), so this proves
  // the listing; GET /api/v1/catalogue's own contract needs the real stack.
  expect(approved.records).toHaveLength(32)
  await startPrivateAccess(page)
  await page.goto('/catalogue')
  const entries = page.locator('.catalogue-list > li')
  await expect(page.getByRole('list', { name: '32 catalogue plants' })).toBeVisible()
  await expect(entries).toHaveCount(32)
  await expect(page.locator('.catalogue-page__intro')).toContainText('Evidence-reviewed catalogue of 32 plants.')

  // The catalogue version and its review date are on the page.
  await expect(page.locator('.catalogue-pack')).toContainText(`v${approved.catalogue_version}`)
  await expect(page.locator('.catalogue-pack')).toContainText(`reviewed ${await mediumDate(page, manifest.last_reviewed)}`)

  // One entry per approved plant: 32 distinct species ids, none missing.
  const links = await entries.locator('a').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href') ?? ''))
  expect(new Set(links).size).toBe(32)
  expect([...links].sort()).toEqual(approved.records.map((record) => `/catalogue/${record.species_id}`).sort())

  // Each has a scientific name, a common name and a reference image that actually loads.
  await expect(entries.locator('.catalogue-list__names strong')).toHaveText(approved.records.map((record) => record.scientific_name))
  await expect(entries.locator('.catalogue-list__names > span')).toHaveText(approved.records.map((record) => record.common_names.join(' · ')))
  for (const record of approved.records) expect(record.common_names.length).toBeGreaterThan(0)
  const images = entries.locator('.catalogue-list__image img')
  await expect(images).toHaveCount(32)
  for (let index = 0; index < 32; index += 1) {
    const image = images.nth(index)
    await image.scrollIntoViewIfNeeded()
    expect(await imageLoaded(image), `reference image ${index + 1} loads`).toBe(true)
  }
})

test('AC 5.2.2 Catalogue search', async ({ page }) => {
  await startPrivateAccess(page)
  await page.goto('/catalogue')
  await expect(page.getByRole('list', { name: '32 catalogue plants' })).toBeVisible()
  const search = page.getByPlaceholder('Search scientific or common name')
  const names = page.locator('.catalogue-list__names strong')
  // "Without reloading the page": a marker on window survives every search.
  await page.evaluate(() => { (window as unknown as { __noReload: boolean }).__noReload = true })
  let navigations = 0
  page.on('framenavigated', () => { navigations += 1 })

  // Part of a scientific name, wrong case.
  await search.fill('MIKAN')
  await expect(names).toHaveText(['Mikania micrantha'])
  // Part of a common name, wrong case.
  await search.fill('hYaCiN')
  await expect(names).toHaveText(['Eichhornia crassipes'])
  // Leading and trailing spaces are ignored.
  await search.fill('   mile-a-minute   ')
  await expect(names).toHaveText(['Mikania micrantha'])
  await expect(page.getByRole('list', { name: '1 catalogue plants' })).toBeVisible()
  // A broader fragment returns every match and only matches.
  await search.fill('acacia')
  const expected = approved.records
    .filter((record) => [record.scientific_name, ...record.common_names].some((name) => name.toLowerCase().includes('acacia')))
    .map((record) => record.scientific_name)
  expect(expected.length).toBeGreaterThan(1)
  await expect(names).toHaveText(expected)

  // No match: the approved wording and a way back.
  await search.fill('not a supported plant')
  const empty = page.locator('.catalogue-empty')
  await expect(empty.locator('strong')).toHaveText('No supported plants found')
  await expect(page.locator('.catalogue-list')).toHaveCount(0)
  await empty.getByRole('button', { name: 'Clear search' }).click()
  await expect(search).toHaveValue('')
  await expect(page.getByRole('list', { name: '32 catalogue plants' })).toBeVisible()
  await expect(names).toHaveCount(32)

  expect(navigations).toBe(0)
  expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true)
  await expect(page).toHaveURL(/\/catalogue$/)
})

test('AC 5.2.3 Plant detail content', async ({ page }) => {
  const record = approved.records.find((item) => item.species_id === 'mikania-micrantha')!
  const detail = details.records.find((item) => item.species_id === record.species_id)!
  await startPrivateAccess(page)
  await page.goto(`/catalogue/${record.species_id}`)
  const article = page.locator('article.catalogue-detail')

  // Names, Malaysian status and a reference image that loads.
  await expect(article.getByRole('heading', { level: 2 })).toHaveText(record.scientific_name)
  await expect(article.locator('.catalogue-detail__common')).toHaveText(record.common_names.join(' · '))
  await expect(article.locator('.catalogue-detail__status')).toHaveText('Present in Malaysia')
  const image = article.getByRole('img', { name: `Reference view of ${record.scientific_name}` })
  await expect(image).toBeVisible()
  expect(await imageLoaded(image)).toBe(true)

  // The reviewed content, section by section, exactly as catalogued.
  const section = (heading: string) => article.locator('section').filter({ has: page.getByRole('heading', { level: 3, name: heading, exact: true }) })
  await expect(section('Identifying characteristics').locator('p').first()).toHaveText(detail.identifying_characteristics)
  await expect(section('Typical habitat').locator('p').first()).toHaveText(detail.typical_habitat)
  await expect(section('Documented impacts').locator('p').first()).toHaveText(detail.documented_impacts)
  expect(detail.safe_response_guidance.length).toBeGreaterThan(0)
  await expect(section('Safe response guidance').locator('.catalogue-detail__steps li')).toHaveText(detail.safe_response_guidance)

  // Source references and the last-reviewed date.
  const credits = section('Sources and credits')
  expect(await credits.locator('.catalogue-sources li').count()).toBeGreaterThan(0)
  await expect(credits).toContainText(`Catalogue v${approved.catalogue_version} · last reviewed ${detail.reviewed_at}`)

  // The reviewed record has no look-alike or severity content, so neither section exists.
  expect(Object.keys(detail).filter((key) => /look|alike|similar|severity/i.test(key))).toEqual([])
  await expect(article.getByRole('heading', { name: /look-?alike|similar (plant|species)|native twin|severity/i })).toHaveCount(0)
})

test('AC 5.2.4 Honest missing information', async ({ page }) => {
  await startPrivateAccess(page)
  // No reviewed record carries a severity assessment or a beginner-safe active action.
  for (const record of details.records) {
    expect(Object.keys(record).filter((key) => /severity|beginner|active_action/i.test(key))).toEqual([])
  }
  for (const speciesId of ['mikania-micrantha', 'eichhornia-crassipes', 'acacia-mangium']) {
    const detail = details.records.find((item) => item.species_id === speciesId)!
    await page.goto(`/catalogue/${speciesId}`)
    const article = page.locator('article.catalogue-detail')
    await expect(article.locator('.catalogue-detail__note')).toHaveText('Formal severity assessment not available')
    await expect(article.locator('.catalogue-detail__cautions')).toContainText('No beginner-safe active action is provided.')

    // No computed severity label anywhere on the page.
    const body = await article.locator('.catalogue-detail__body').innerText()
    expect(body).not.toMatch(/severity:\s*\w|\b(high|medium|moderate|low|severe|critical|extreme)\s+(severity|risk|threat|impact)\b|risk level|threat level|severity score/i)
    expect(body).not.toMatch(/\d+\s*%|confidence/i)
    // Guidance is the reviewed text and nothing else: no generated removal step.
    await expect(article.locator('.catalogue-detail__steps li')).toHaveText(detail.safe_response_guidance)
    const cautions = await article.locator('.catalogue-detail__cautions li').allInnerTexts()
    expect(cautions).toEqual([
      'No beginner-safe active action is provided.',
      'Outside a mapped protected area does not mean removal is permitted. Confirm permission first.',
    ])
  }
})

test('AC 5.2.5 References and image attribution', async ({ page }) => {
  // The validation rule itself: every catalogue image carries its creator,
  // licence, source and review date.
  expect(manifest.assets).toHaveLength(32)
  for (const asset of manifest.assets) {
    for (const field of ['creator', 'licence', 'source_title', 'source_url_or_identifier', 'reviewed_at'] as const) {
      expect(asset[field], `${asset.species_id} ${field}`).toMatch(/\S/)
    }
  }

  await startPrivateAccess(page)
  const sources = new Map([...approved.sources, ...details.sources].map((source) => [source.source_id, source]))
  for (const speciesId of ['mikania-micrantha', 'salvinia-molesta']) {
    const record = approved.records.find((item) => item.species_id === speciesId)!
    const detail = details.records.find((item) => item.species_id === speciesId)!
    const asset = manifest.assets.find((item) => item.species_id === speciesId)!
    const cited = [...new Set([...record.evidence_source_ids, ...Object.values(detail.source_ids).flat()])]
      .map((id) => sources.get(id)!)
    expect(cited.length).toBeGreaterThan(0)

    await page.goto(`/catalogue/${speciesId}`)
    const credits = page.locator('.catalogue-detail__credits')
    await expect(credits.getByRole('heading', { name: 'Sources and credits' })).toBeVisible()

    // Each factual source: its title, its URL and its identifier.
    const rows = credits.locator('.catalogue-sources li')
    await expect(rows).toHaveCount(cited.length)
    for (const [index, source] of cited.entries()) {
      const link = rows.nth(index).getByRole('link')
      await expect(link).toHaveText(source.title)
      await expect(link).toHaveAttribute('href', source.url)
      await expect(rows.nth(index).locator('code')).toHaveText(source.source_id)
      await expect(rows.nth(index)).toContainText(source.publisher)
    }

    // The image: creator, licence, source and review date.
    const attribution = credits.locator('p').filter({ hasText: /^Image:/ })
    await expect(attribution).toContainText(`Image: ${asset.creator} · ${asset.licence} · ${asset.source_title}`)
    await expect(attribution).toContainText(`reviewed ${asset.reviewed_at}`)
    await expect(attribution.getByRole('link', { name: asset.source_title })).toHaveAttribute('href', asset.source_url_or_identifier)
    // The information review date.
    await expect(credits).toContainText(`last reviewed ${detail.reviewed_at}`)
  }
})

test('AC 5.2.6 Consistent plant record linking', async ({ page }) => {
  await pinModelSpecies(page, 'mikania_micrantha')
  await startPrivateAccess(page)
  const snapshot = async () => {
    await expect(page).toHaveURL(/\/catalogue\/mikania-micrantha$/)
    const article = page.locator('article.catalogue-detail')
    await expect(article.getByRole('heading', { level: 2 })).toHaveText('Mikania micrantha')
    return {
      names: await article.locator('.catalogue-detail__intro h2, .catalogue-detail__common').allInnerTexts(),
      image: (await article.locator('.catalogue-detail__media img').getAttribute('src')),
      content: await article.locator('.catalogue-detail__body').innerText(),
    }
  }

  // From catalogue search.
  await page.goto('/catalogue')
  await page.getByPlaceholder('Search scientific or common name').fill('mile-a-minute')
  await page.getByRole('link', { name: /Mikania micrantha/ }).click()
  const fromSearch = await snapshot()
  expect(fromSearch.content).toContain('Identifying characteristics')

  // From a place-association card.
  await page.goto(`/places/${BUKIT_KIARA}`)
  await page.locator('.place-associations > li').filter({ hasText: 'Mikania micrantha' })
    .getByRole('link', { name: 'View catalogue entry' }).click()
  expect(await snapshot()).toEqual(fromSearch)

  // From a scan result. The result names the plant the same way the catalogue does.
  await scanPhoto(page)
  await expect(page.getByRole('heading', { name: 'Mile-a-minute weed' })).toBeVisible()
  const link = page.getByRole('link', { name: 'View catalogue entry for Mikania micrantha' })
  await expect(link).toHaveAttribute('href', '/catalogue/mikania-micrantha')
  await link.click()
  const fromScan = await snapshot()
  expect(fromScan).toEqual(fromSearch)
  expect(fromScan.names).toEqual(['Mikania micrantha', 'Mile-a-minute weed'])
})

test('AC 5.3.3 Offline state communication - offline messaging without an installed pack', async ({ page }) => {
  // The installed-pack half (installed version, cached images) runs against the
  // production build in e2e/pwa.spec.ts. Here the bundled catalogue stands in:
  // going offline must still say so, show the review date, and keep the
  // catalogue usable while server-backed screens explain themselves.
  await installOnlineSwitch(page)
  await startPrivateAccess(page)
  await page.goto('/catalogue')
  await expect(page.getByRole('list', { name: '32 catalogue plants' })).toBeVisible()
  await expect(page.locator('.catalogue-offline-notice')).toHaveCount(0)

  await goOffline(page)
  const notice = page.locator('.catalogue-offline-notice')
  await expect(notice.locator('strong')).toHaveText('Offline catalogue')
  await expect(notice).toContainText(`Bundled catalogue · last reviewed ${await mediumDate(page, approved.reviewed_at)}.`)
  await expect(notice).toContainText('Map and current place data need a connection.')
  // Cached catalogue content is still reachable: list, search and a plant's detail.
  await expect(page.locator('.catalogue-list > li')).toHaveCount(32)
  await page.getByPlaceholder('Search scientific or common name').fill('salvinia')
  await page.getByRole('link', { name: /Salvinia molesta/ }).click()
  const detailNotice = page.locator('.catalogue-detail .catalogue-offline-notice')
  await expect(detailNotice).toContainText(`Offline catalogue · v${approved.catalogue_version}`)
  await expect(detailNotice).toContainText(`Last reviewed ${approved.reviewed_at}.`)
  await expect(page.getByRole('heading', { name: 'Identifying characteristics' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Sources and credits' })).toBeVisible()

  // Screens that need current server or map data say so and point back to the catalogue.
  await navigateInApp(page, '/places')
  const places = page.locator('.places-state')
  await expect(places).toContainText('Mapped places and current association data need a connection. The offline plant catalogue remains available.')
  await navigateInApp(page, `/places/${BUKIT_KIARA}`)
  await expect(page.locator('.places-state')).toContainText('Mapped place geometry and current association evidence need a connection.')
  await navigateInApp(page, '/adopted-areas')
  await expect(page.locator('.areas-state')).toContainText('Adopted-area activity needs a connection.')
  await page.getByRole('link', { name: 'Open offline catalogue' }).click()
  await expect(page).toHaveURL(/\/catalogue$/)
  await expect(page.locator('.catalogue-list > li')).toHaveCount(32)
  await expect(page.locator('.catalogue-offline-notice strong')).toHaveText('Offline catalogue')
})
