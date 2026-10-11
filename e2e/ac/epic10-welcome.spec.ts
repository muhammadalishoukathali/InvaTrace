// Epic 10: the public welcome page. One test per acceptance criterion, each
// asserting what the criterion's Then and Display lines say. The page is static
// content, so there is nothing to mock; a visitor here has no identity at all.
import { expect, test, type Locator, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const hero = (page: Page) => page.locator('header.welcome-hero')
const nav = (page: Page) => page.locator('.welcome-nav')
const problem = (page: Page) => page.getByRole('region', { name: 'What is an invasive plant?' })
const features = (page: Page) => page.getByRole('region', { name: 'What you can do with InvaTrace' })
const howItWorks = (page: Page) => page.getByRole('region', { name: 'How InvaTrace helps' })
const closing = (page: Page) => page.locator('section.welcome-closing')

/** Lazy images only load near the viewport, so bring one into view first. */
async function expectLoaded(image: Locator) {
  await image.scrollIntoViewIfNeeded()
  await expect.poll(() => image.evaluate((element) => {
    const img = element as HTMLImageElement
    return img.complete && img.naturalWidth > 0
  })).toBe(true)
}

const sentences = (text: string) => text.split(/(?<=[.!?])\s+/).filter((part) => part.trim().length > 0)

test('AC 10.1.1 Landing page first view: the name, purpose, Malaysian problem statement and Start privately are on the first screen', async ({ page }) => {
  const identityCalls: string[] = []
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname
    if (pathname.startsWith('/api/v1/profiles')) identityCalls.push(pathname)
  })
  await page.goto('/')
  // A first-time visitor stays on "/" and no identity is created by reading it.
  await expect(page).toHaveURL(/\/$/)

  // The InvaTrace name.
  await expect(nav(page).getByLabel('InvaTrace')).toBeInViewport()
  await expect(nav(page).getByText('InvaTrace', { exact: true })).toBeVisible()
  // Hero: eyebrow, headline, the two actions.
  await expect(hero(page).getByText('For Malaysia’s parks and trails')).toBeInViewport()
  await expect(hero(page).getByRole('heading', { level: 1 })).toHaveText('Spot invasive plants. Care for the places you love.')
  await expect(hero(page).getByRole('heading', { level: 1 })).toBeInViewport()
  const start = hero(page).getByRole('button', { name: 'Start privately' })
  await expect(start).toHaveCount(1)
  await expect(start).toBeInViewport()
  await expect(hero(page).getByRole('link', { name: 'How it works' })).toBeInViewport()

  // A short Malaysian invasive-plant problem statement, then the purpose in one sentence.
  const lede = sentences((await hero(page).locator('.welcome-hero__lede').innerText()).trim())
  expect(lede).toHaveLength(2)
  expect(lede[0]).toMatch(/invasive plant/i)
  expect(lede[0]).toMatch(/Malaysia/)
  expect(lede[1]).toBe('Using InvaTrace, you can identify the invasives, document findings and return to see how things have changed.')

  // Scan-result preview, SDG 15 badge, and the photo's location and credit.
  const preview = hero(page).locator('figure.welcome-example')
  await expect(preview.getByRole('img')).toHaveAttribute('alt', /^InvaTrace identification result/)
  await expectLoaded(preview.getByRole('img'))
  await expect(hero(page).getByText('Supporting SDG 15 · Life on Land')).toBeVisible()
  await expect(hero(page).locator('.welcome-hero__credit')).toContainText('Labis, Johor, Malaysia')
  await expect(hero(page).locator('.welcome-hero__credit')).toContainText('Photo by Ihsan Adityawarman · Pexels')
  await expectLoaded(hero(page).locator('img.welcome-hero__photo'))

  // The navigation does not repeat a hero action.
  await expect(nav(page).getByRole('button')).toHaveCount(0)
  await expect(nav(page).getByRole('link', { name: /How it works|Start privately/ })).toHaveCount(0)
  expect(identityCalls).toEqual([])

  // /welcome stays publicly accessible.
  await page.goto('/welcome')
  await expect(page).toHaveURL(/\/welcome$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Spot invasive plants. Care for the places you love.')
  await expect(hero(page).getByRole('button', { name: 'Start privately' })).toBeVisible()
  expect(identityCalls).toEqual([])
})

test('AC 10.1.1, AC 10.2.3 Landing page navigation: the navigation shows the logo only and Restore access is a link in the hero and the closing section', async ({ page }) => {
  await page.goto('/')
  // Navigation: the logo, and nothing that repeats a hero action.
  await expect(nav(page).getByLabel('InvaTrace')).toBeVisible()
  await expect(nav(page).getByRole('link')).toHaveCount(0)
  await expect(nav(page).getByRole('button')).toHaveCount(0)

  // Restore access is offered in the hero and in the closing section, and nowhere else.
  const heroRestore = hero(page).getByRole('link', { name: 'Already use InvaTrace? Restore access' })
  const closingRestore = closing(page).getByRole('link', { name: 'Restore an existing profile' })
  await expect(heroRestore).toBeInViewport()
  await expect(heroRestore).toHaveAttribute('href', '/private-access/restore')
  await expect(closingRestore).toHaveAttribute('href', '/private-access/restore')
  await expect(page.locator('a[href="/private-access/restore"]')).toHaveCount(2)

  await closingRestore.click()
  await expect(page).toHaveURL(/\/private-access\/restore$/)
  await page.goBack()
  await heroRestore.click()
  await expect(page).toHaveURL(/\/private-access\/restore$/)
  await expect(page.getByLabel('Recovery code')).toBeVisible()
})

test('AC 10.1.2 Problem explanation: a definition, a credited infestation photograph and the three impacts', async ({ page }) => {
  await page.goto('/')
  const section = problem(page)
  await section.scrollIntoViewIfNeeded()

  // What an invasive plant is, in one sentence.
  const definition = section.locator('.welcome-why__intro p').nth(1)
  await expect(definition).toHaveText('Invasive plants are those which are alien to a location and whose growth adversely affects the surroundings, the economy and the well-being of the population.')
  expect(sentences(await definition.innerText())).toHaveLength(1)

  // At least one photograph of a heavy infestation, with species name, caption and credit.
  const figure = section.locator('figure.welcome-why__photo')
  const infestation = figure.getByRole('img', { name: /completely covered by Salvinia molesta/ })
  await expect(infestation).toHaveCount(1)
  await expectLoaded(infestation)
  const caption = figure.locator('figcaption')
  await expect(caption).toContainText('Giant salvinia')
  await expect(caption.locator('em')).toHaveText('Salvinia molesta')
  await expect(caption).toContainText('Kolam Sepat at Universiti Putra Malaysia')
  await expect(caption).toContainText('Wee Hong, Wikimedia Commons (CC BY-SA 4.0)')
  await expect(caption.getByRole('link', { name: /Wee Hong, Wikimedia Commons/ }))
    .toHaveAttribute('href', 'https://commons.wikimedia.org/wiki/File:Bukit_Ekspo_(Kolam_5),_UPM.jpg')

  // Three impact cards: native vegetation displaced, habitat and food for
  // wildlife reduced, natural places used by communities degraded.
  const cards = section.locator('.welcome-impacts li')
  await expect(cards).toHaveCount(3)
  await expect(cards.getByRole('heading')).toHaveText(['Native vegetation', 'Native habitats', 'Shared natural spaces'])
  await expect(cards.nth(0)).toContainText('can out-compete native species for light, water and space')
  await expect(cards.nth(1)).toContainText('reduces the food and habitat available to wildlife')
  await expect(cards.nth(2)).toContainText('Parks and trails communities enjoy can lose the variety that makes them distinct')
})

test('AC 10.1.3 Problem sources: readable source names link out in a new tab and leave the landing page in place', async ({ page, context }) => {
  // The test checks where a link goes, not that a third-party site is up.
  await context.route(/^https:\/\/(www\.)?(mybis\.gov\.my|nps\.gov|sdgs\.un\.org)\//, (route) => (
    route.fulfill({ status: 200, contentType: 'text/html', body: '<title>source</title>' })
  ))
  await page.goto('/')
  const sources = problem(page).locator('.welcome-sources')
  await expect(sources).toContainText('Sources:')
  const links = sources.getByRole('link')
  const expected = [
    { name: 'Malaysia Invasive Alien Species (MyIAS)', href: 'https://www.mybis.gov.my/ias/' },
    { name: 'MyBIS: Invasive Alien Species', href: 'https://www.mybis.gov.my/art/12' },
    { name: 'National Park Service: Invasive Plants', href: 'https://www.nps.gov/articles/invasive-plants-brief.htm' },
  ]
  // Readable names, not bare URLs.
  await expect(links).toHaveText(expected.map((source) => source.name))

  for (const source of expected) {
    const link = sources.getByRole('link', { name: source.name, exact: true })
    await expect(link).toHaveAttribute('href', source.href)
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', /noopener/)
    // Opens its external page in a new tab...
    const opened = page.waitForEvent('popup')
    await link.click()
    const tab = await opened
    await expect(tab).toHaveURL(source.href)
    await tab.close()
    // ...without taking the visitor away from, or covering, the landing page.
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('dialog')).toHaveCount(0)
  }
  // The rest of the page is still reachable straight after.
  await page.getByRole('link', { name: 'How it works' }).first().click()
  await expect(howItWorks(page).getByRole('heading', { name: 'How InvaTrace helps' })).toBeInViewport()

  // The SDG statement names and links its source the same way.
  const sdg = page.getByRole('link', { name: 'UN Sustainable Development Goal 15' })
  await expect(sdg).toHaveAttribute('href', 'https://sdgs.un.org/goals/goal15')
  await expect(sdg).toHaveAttribute('target', '_blank')
})

test('AC 10.1.4 Image credit and plant status: every photograph is credited and the hero and scan preview carry the stated lines', async ({ page }) => {
  await page.goto('/')

  // Hero: "Labis, Johor, Malaysia · Photo by Ihsan Adityawarman · Pexels".
  const credit = hero(page).locator('.welcome-hero__credit')
  await expect(credit.locator('span').first()).toHaveText('Labis, Johor, Malaysia')
  await expect(credit.locator('span').nth(1)).toHaveText('Photo by Ihsan Adityawarman · Pexels')
  await expect(credit.getByRole('link', { name: 'Ihsan Adityawarman · Pexels' })).toHaveAttribute('href', /^https:\/\/www\.pexels\.com\/photo\//)

  // Scan-result preview: "Listed as invasive in Malaysia · Status source: GRIIS Malaysia".
  const preview = hero(page).locator('figure.welcome-example figcaption')
  await expect(preview.locator('strong')).toHaveText('Listed as invasive in Malaysia')
  await expect(preview.locator('span')).toHaveText('Status source: GRIIS Malaysia')
  await expect(preview.getByRole('link', { name: 'GRIIS Malaysia' })).toHaveAttribute('href', /^https:\/\/www\.gbif\.org\/species\//)

  // The infestation photographs: each has its own photographer, source and licence.
  const infestation = problem(page).locator('figure.welcome-why__photo')
  await expect(infestation.locator('figcaption')).toContainText('Across Malaysia.')
  await expect(infestation.locator('figcaption')).toContainText('Wee Hong, Wikimedia Commons (CC BY-SA 4.0)')
  await expect(infestation.locator('figcaption')).toContainText('Rubenjoker, Wikimedia Commons (CC BY-SA 4.0)')

  // Those are all the photographs on the page: every other image is a product
  // screenshot or the logo. A photograph added later has to come with its own credit here.
  const images = await page.locator('img').evaluateAll((elements) => elements.map((element) => ({
    src: new URL((element as HTMLImageElement).currentSrc || (element as HTMLImageElement).src).pathname,
    creditedFigure: Boolean(element.closest('figure.welcome-why__photo, header.welcome-hero')),
  })))
  const photographs = images.filter((image) => !/\/welcome\/screen-|\/invatrace-logo/.test(image.src))
  expect(photographs.map((image) => image.src).sort()).toEqual([
    expect.stringMatching(/^\/welcome\/hero-/),
    '/welcome/malaysia-salvinia-upm-1200.webp',
    '/welcome/malaysia-wetland-chini-1200.webp',
  ])
  for (const photograph of photographs) expect(photograph.creditedFigure).toBe(true)
  // The footer repeats photographer and source for every pair photo.
  const footer = page.locator('footer.welcome-footer')
  await expect(footer).toContainText('Ihsan Adityawarman · Pexels')
  await expect(footer).toContainText('Wee Hong · Wikimedia Commons')
  await expect(footer).toContainText('Rubenjoker · Wikimedia Commons')

  // Every plant example is a species the app's own reviewed catalogue lists as invasive in Malaysia.
  const catalogue = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'shared/catalogue/approved-species.json'), 'utf8')) as {
    records: Array<{ scientific_name: string }>
  }
  const listed = catalogue.records.map((record) => record.scientific_name)
  expect(listed).toContain('Salvinia molesta')
  expect(listed).toContain('Asclepias curassavica')
  await expect(hero(page).locator('figure.welcome-example img')).toHaveAttribute('alt', /Tropical milkweed, marked Invasive in Malaysia/)
  await expect(infestation.locator('figcaption')).toContainText('Listed as invasive in Malaysia · Status source: GRIIS Malaysia')
})

test('AC 10.1.4 Image credit and plant status: every plant example names its status source', async ({ page }) => {
  await page.goto('/')
  await expect(hero(page).locator('figure.welcome-example figcaption')).toContainText('Status source: GRIIS Malaysia')
  const salvinia = problem(page).locator('figure.welcome-why__photo figcaption')
  await expect(salvinia).toContainText('Giant salvinia')
  await expect(salvinia).toContainText('Listed as invasive in Malaysia · Status source: GRIIS Malaysia')
  // The named source is the one the reviewed catalogue records for Salvinia molesta.
  const catalogue = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'shared/catalogue/approved-species.json'), 'utf8')) as {
    records: Array<{ scientific_name: string; evidence_source_ids: string[] }>
    sources: Array<{ source_id: string; publisher: string; url: string }>
  }
  const record = catalogue.records.find((item) => item.scientific_name === 'Salvinia molesta')!
  const source = catalogue.sources.find((item) => record.evidence_source_ids.includes(item.source_id) && item.publisher === 'GRIIS')!
  await expect(salvinia.getByRole('link', { name: 'GRIIS Malaysia' })).toHaveAttribute('href', source.url)
  await expect(salvinia.getByRole('link', { name: 'GRIIS Malaysia' })).toHaveAttribute('target', '_blank')
})

test('AC 10.2.1 App workflow explanation: How it works is five ordered steps that fit phone and desktop layouts', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'How it works' }).first().click()
  const section = howItWorks(page)
  await expect(section.getByRole('heading', { name: 'How InvaTrace helps' })).toBeInViewport()
  await expect(page).toHaveURL(/#how-it-works$/)

  // An ordered list of five steps, each a title and a one-sentence explanation.
  const list = section.locator('ol.welcome-steps')
  const steps = list.locator('> li')
  await expect(steps).toHaveCount(5)
  for (const step of await steps.all()) {
    await expect(step.getByRole('heading', { level: 3 })).toHaveText(/\S/)
    expect(sentences(await step.locator('p').innerText())).toHaveLength(1)
  }

  // Desktop: the five steps sit side by side. Phone: they stack, with no sideways scroll.
  const columns = async () => new Set(await steps.evaluateAll((items) => items.map((item) => Math.round(item.getBoundingClientRect().left)))).size
  await page.setViewportSize({ width: 1280, height: 800 })
  expect(await columns()).toBe(5)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await columns()).toBe(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  const tops = await steps.evaluateAll((items) => items.map((item) => item.getBoundingClientRect().top))
  expect([...tops].sort((a, b) => a - b)).toEqual(tops)
})

test('AC 10.2.1 App workflow explanation: the steps are Discover what to look for, Identify a plant, Follow safe guidance, Report a sighting, Monitor places over time', async ({ page }) => {
  await page.goto('/')
  const steps = howItWorks(page).locator('ol.welcome-steps > li')
  await expect(steps.getByRole('heading', { level: 3 })).toHaveText([
    'Discover what to look for',
    'Identify a plant',
    'Follow safe guidance',
    'Report a sighting',
    'Monitor places over time',
  ])
  // Each step explains itself: places, identification, safety, reporting, revisiting.
  await expect(steps.locator('p')).toHaveText([
    'Explore mapped places and the plants recorded there.',
    'Photograph a plant to get a suggested identification.',
    'Read the safety guidance before you touch anything.',
    'Record what you saw and where you saw it.',
    'Return later to check the same spot for regrowth.',
  ])
})

test('AC 10.2.2 Feature accuracy: descriptions are cautious, shown with current product screenshots, and the described features exist', async ({ page }) => {
  await page.goto('/')
  const copy = await page.locator('.welcome').innerText()

  // No guaranteed identification, removal or confirmed-presence claims, and no expert confirmation.
  expect(copy).not.toMatch(/guarantee|100\s?%|always (identif|correct|accurate)|never wrong|certif|expert[- ](confirmed|verified|validated)|verified by experts|confirmed (presence|sighting|location)|will (remove|eradicate|restore|eliminate)|eradicat/i)
  // The wording that is there is hedged.
  await expect(page.locator('footer.welcome-footer')).toContainText('Identifications are suggestions from an image-recognition model, not expert confirmation.')
  await expect(features(page)).toContainText('to see what it is likely to be')
  await expect(howItWorks(page)).toContainText('to get a suggested identification')
  await expect(features(page)).toContainText('when to leave removal to the land manager')

  // Each feature carries a real product screenshot, described as an InvaTrace screen.
  const cards = features(page).locator('article.welcome-feature')
  expect(await cards.count()).toBeGreaterThanOrEqual(3)
  for (const card of await cards.all()) {
    const shot = card.getByRole('img')
    await expect(shot).toHaveAttribute('src', /^\/welcome\/screen-[a-z-]+\.webp$/)
    await expect(shot).toHaveAttribute('alt', /^InvaTrace /)
    await expectLoaded(shot)
    await expect(card.getByText(/coming soon|upcoming|planned/i)).toHaveCount(0)
  }

  // None is labelled upcoming, so each described feature must be available in the app.
  await hero(page).getByRole('button', { name: 'Start privately' }).click()
  await expect(page).toHaveURL(/\/private-access\/recovery$/)
  await page.getByRole('checkbox', { name: 'I have saved my recovery kit' }).check()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page).toHaveURL(/\/map$/)
  const primary = page.getByRole('navigation', { name: 'Primary' })
  for (const [described, destination] of [
    ['mapped places and their watchlists', '/places'],
    ['plant look-up and guidance', '/catalogue'],
    ['community survey events', '/events'],
    ['adopted places', '/adopted-areas'],
    ['recorded sightings', '/reports'],
  ]) {
    await expect(primary.locator(`a[href="${destination}"]`), described).toHaveCount(1)
  }
  await expect(page.getByRole('button', { name: /Scan a plant|New scan/ }).first()).toBeVisible()
})

test('AC 10.2.3 Clear next action: Start privately closes the hero, the problem section and the page, and starts private access', async ({ page }) => {
  await page.goto('/')

  // Exactly one in each of the three places.
  await expect(page.getByRole('button', { name: 'Start privately' })).toHaveCount(3)
  await expect(hero(page).getByRole('button', { name: 'Start privately' })).toHaveCount(1)
  await expect(problem(page).getByRole('button', { name: 'Start privately' })).toHaveCount(1)
  await expect(closing(page).getByRole('button', { name: 'Start privately' })).toHaveCount(1)

  // End of the problem section: the action is the last thing in it, on screen
  // with the section's end, with the hero's own button scrolled away.
  const sectionAction = problem(page).getByRole('button', { name: 'Start privately' })
  expect(await problem(page).evaluate((section) => section.lastElementChild?.querySelector('button')?.textContent)).toBe('Start privately')
  await sectionAction.scrollIntoViewIfNeeded()
  await expect(sectionAction).toBeInViewport()
  await expect(hero(page).getByRole('button', { name: 'Start privately' })).not.toBeInViewport()

  // End of the solution sections: the closing action follows How it works.
  const order = await page.evaluate(() => {
    const all = [...document.querySelectorAll('main > section')].map((section) => section.className.split(' ')[0])
    return { features: all.indexOf('welcome-features'), how: all.indexOf('welcome-how'), closing: all.indexOf('welcome-closing'), last: all.length - 1 }
  })
  expect(order.closing).toBe(order.last)
  expect(order.features).toBeLessThan(order.closing)
  expect(order.how).toBeLessThan(order.closing)
  const closingAction = closing(page).getByRole('button', { name: 'Start privately' })
  await closingAction.scrollIntoViewIfNeeded()
  await expect(closingAction).toBeInViewport()

  // Restore access is offered and leads to the restore page.
  await expect(page.getByRole('link', { name: 'Already use InvaTrace? Restore access' })).toHaveAttribute('href', '/private-access/restore')
  await expect(closing(page).getByRole('link', { name: 'Restore an existing profile' })).toHaveAttribute('href', '/private-access/restore')
  // The navigation repeats no hero action.
  await expect(nav(page).getByRole('button')).toHaveCount(0)
  await expect(nav(page).getByRole('link', { name: /How it works|Start privately/ })).toHaveCount(0)

  // The section action does the real thing: POST /api/v1/profiles/start, then the recovery kit.
  const started = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/profiles/start')
  await sectionAction.click()
  const response = await started
  expect(response.request().method()).toBe('POST')
  expect(response.status()).toBeLessThan(300)
  await expect(page).toHaveURL(/\/private-access\/recovery$/)
  await expect(page.getByRole('heading', { name: 'Save your recovery kit' })).toBeVisible()
})

test('AC 10.2.3 Clear next action: Restore access opens the restore page', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Already use InvaTrace? Restore access' }).click()
  await expect(page).toHaveURL(/\/private-access\/restore$/)
  await expect(page.getByLabel('Recovery code')).toBeVisible()
})

test('AC 10.2.4 Main features: Scan and report, Learn how to prevent and stop spread, and Work together as a community, each with one sentence and a product screenshot', async ({ page }) => {
  await page.goto('/')
  const section = features(page)
  await section.scrollIntoViewIfNeeded()
  const cards = section.locator('article.welcome-feature')
  // The three main features lead the section, in this order (two further
  // "before and after a walk" cards follow them).
  await expect(cards.getByRole('heading', { level: 3 }).first()).toHaveText('Scan and report')
  await expect(cards.getByRole('heading', { level: 3 }).nth(1)).toHaveText('Learn how to prevent and stop spread')
  await expect(cards.getByRole('heading', { level: 3 }).nth(2)).toHaveText('Work together as a community')

  const expected = [
    { title: 'Scan and report', screenshot: '/welcome/screen-scan.webp', about: /Photograph a plant .* then report where you found it\.$/ },
    { title: 'Learn how to prevent and stop spread', screenshot: '/welcome/screen-prevent.webp', about: /how it spreads, what not to do/ },
    { title: 'Work together as a community', screenshot: '/welcome/screen-events.webp', about: /Join or host a survey event/ },
  ]
  for (const feature of expected) {
    const card = cards.filter({ has: page.getByRole('heading', { level: 3, name: feature.title, exact: true }) })
    await expect(card).toHaveCount(1)
    // A one-sentence description.
    const description = (await card.locator('p').innerText()).trim()
    expect(sentences(description)).toHaveLength(1)
    expect(description).toMatch(feature.about)
    // A product screenshot that actually loads.
    const screenshot = card.getByRole('img')
    await expect(screenshot).toHaveCount(1)
    await expect(screenshot).toHaveAttribute('src', feature.screenshot)
    await expect(screenshot).toHaveAttribute('alt', /^InvaTrace /)
    await expectLoaded(screenshot)
  }
})
