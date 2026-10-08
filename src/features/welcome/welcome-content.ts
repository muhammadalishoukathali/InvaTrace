// Everything on the public welcome page that is expected to change later
// lives here: images, photo credit, fact sources and the short copy lists.
// Swapping a placeholder screenshot or editing a source should only ever
// need an edit to this file, not to WelcomePage.tsx or welcome.css.

export interface WelcomeImage {
  /** Public URL under /welcome/ (files live in public/welcome/). */
  src: string
  /** Intrinsic pixel size, so the browser reserves space before loading. */
  width: number
  height: number
  alt: string
  /** true while the image is a concept mock-up with example data. */
  placeholder: boolean
}

export const HERO_IMAGE = {
  // Two widths of the same 16:9 frame; the browser picks by screen size.
  landscape: { src: '/welcome/hero-1600.webp', width: 1600, height: 900 },
  landscapeLarge: { src: '/welcome/hero-2400.webp', width: 2400, height: 1350 },
  portrait: { src: '/welcome/hero-portrait-1080.webp', width: 1080, height: 1350 },
  alt: 'Morning sunlight falling across a forest park path in Johor, Malaysia',
}

export const HERO_PHOTO_CREDIT = {
  author: 'Ihsan Adityawarman',
  source: 'Pexels',
  href: 'https://www.pexels.com/photo/sunlight-filtering-through-forest-in-labis-34937417/',
}

export const SCREENS = {
  identify: {
    src: '/welcome/screen-identify.webp',
    width: 760,
    height: 597,
    alt: 'InvaTrace identification result: Tropical milkweed, marked Invasive in Malaysia',
    placeholder: false,
  },
  mission: {
    src: '/welcome/screen-field-mission.webp',
    width: 585,
    height: 1140,
    alt: 'InvaTrace guided mission preview for Taman Tasik Titiwangsa: compatible habitat highlighted on the map for 3 watchlist plants',
    placeholder: false,
  },
  events: {
    src: '/welcome/screen-events.webp',
    width: 585,
    height: 1110,
    alt: 'InvaTrace community events: find surveys by species and date, or host your own',
    placeholder: false,
  },
  followUp: {
    src: '/welcome/screen-follow-up.webp',
    width: 585,
    height: 1195,
    alt: 'InvaTrace sighting marked Follow-up needed after a reported removal, with a Start follow-up button',
    placeholder: false,
  },
} satisfies Record<string, WelcomeImage>

// UN Sustainable Development Goal link. The badge is shown in the hero, the
// statement right after the problem section.
export const SDG = {
  badge: 'Supporting SDG 15 · Life on Land',
  target: 'Target 15.8',
  statement:
    'Identifying, reporting and revisiting invasive plants supports public action on Target 15.8: reducing the impact of invasive alien species on land and water ecosystems.',
  sourceLabel: 'UN Sustainable Development Goal 15',
  href: 'https://sdgs.un.org/goals/goal15',
} as const

export const IMPACTS = [
  {
    title: 'Native vegetation',
    detail: 'Invasive plants can out-compete native species for light, water and space.',
  },
  {
    title: 'Native habitats',
    detail: 'Losing native plants reduces the food and habitat available to wildlife.',
  },
  {
    title: 'Shared natural spaces',
    detail: 'Parks and trails communities enjoy can lose the variety that makes them distinct.',
  },
] as const

// Readable source names for the statements above (AC 10.1.3).
export const FACT_SOURCES = [
  { label: 'Malaysia Invasive Alien Species (MyIAS)', href: 'https://www.mybis.gov.my/ias/' },
  { label: 'MyBIS: Invasive Alien Species', href: 'https://www.mybis.gov.my/art/12' },
  { label: 'National Park Service: Invasive Plants', href: 'https://www.nps.gov/articles/invasive-plants-brief.htm' },
] as const

export const FEATURES = [
  {
    id: 'know',
    title: 'Know what to look for',
    detail: 'Choose a mapped place and check its invasive plant watchlist before you set out.',
    screen: SCREENS.mission,
  },
  {
    id: 'visit',
    title: 'Make your visit count',
    detail: 'Follow safety guidance, report a sighting or join a community event to observe with others.',
    screen: SCREENS.events,
  },
  {
    id: 'changes',
    title: 'See what changes',
    detail: 'Adopt places you care about. Revisit recorded sightings, check for regrowth and add a new observation.',
    screen: SCREENS.followUp,
  },
] as const

// Icon names must exist in src/components/Icon.tsx.
export const STEPS = [
  { title: 'Discover what to look for', detail: 'Explore mapped places and the plants recorded there.', icon: 'MapPinned' },
  { title: 'Identify a plant', detail: 'Photograph a plant to get a suggested identification.', icon: 'Camera' },
  { title: 'Follow safe guidance', detail: 'Read the safety guidance before you touch anything.', icon: 'ShieldCheck' },
  { title: 'Report a sighting', detail: 'Record what you saw and where you saw it.', icon: 'Send' },
  { title: 'Monitor places over time', detail: 'Return later to check the same spot for regrowth.', icon: 'RefreshCw' },
] as const
