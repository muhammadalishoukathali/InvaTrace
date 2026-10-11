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
  location: 'Labis, Johor, Malaysia',
  author: 'Ihsan Adityawarman',
  source: 'Pexels',
  href: 'https://www.pexels.com/photo/sunlight-filtering-through-forest-in-labis-34937417/',
}

// Status line under the example result card. The plant must be listed as
// invasive in Malaysia; GRIIS Malaysia record for Asclepias curassavica.
export const EXAMPLE_STATUS = {
  label: 'Listed as invasive in Malaysia',
  sourceLabel: 'GRIIS Malaysia',
  href: 'https://www.gbif.org/species/160892655',
}

export const INVASIVE_PLANT = {
  definition:
    'Invasive plants are those which are alien to a location and whose growth adversely affects the surroundings, the economy and the well-being of the population.',
  // Two Malaysian scenes shown side by side. The first is a pond at UPM
  // (Serdang, Selangor) smothered by Salvinia molesta; the second is Tasik
  // Chini in Pahang kept clear and open. Each image carries its own
  // photographer, source and licence so the credit matches what is shown.
  photos: [{
    src: '/welcome/malaysia-salvinia-upm-1200.webp',
    width: 1200,
    height: 418,
    label: 'Weed-choked',
    alt: 'Kolam Sepat pond at Universiti Putra Malaysia, Serdang, Selangor, its surface completely covered by Salvinia molesta',
    credit: {
      author: 'Wee Hong',
      source: 'Wikimedia Commons',
      licence: 'CC BY-SA 4.0',
      href: 'https://commons.wikimedia.org/wiki/File:Bukit_Ekspo_(Kolam_5),_UPM.jpg',
    },
  }, {
    src: '/welcome/malaysia-wetland-chini-1200.webp',
    width: 1200,
    height: 418,
    label: 'Open water',
    alt: 'Tasik Chini in Pahang, Malaysia with open water, floating native vegetation and forested shoreline',
    credit: {
      author: 'Rubenjoker',
      source: 'Wikimedia Commons',
      licence: 'CC BY-SA 4.0',
      href: 'https://commons.wikimedia.org/wiki/File:Tasik_chini_03.jpg',
    },
  }],
  caption: {
    place: 'Across Malaysia.',
    commonName: 'Giant salvinia',
    scientificName: 'Salvinia molesta',
    story:
      'forms thick floating mats that smother ponds, lakes and slow rivers — like Kolam Sepat at Universiti Putra Malaysia (left). Where invasive aquatic weeds are kept out, Malaysian waterbodies such as Tasik Chini in Pahang (right) stay open, oxygenated and alive.',
  },
  // Same form as EXAMPLE_STATUS. Salvinia molesta is in the reviewed catalogue
  // with GRIIS Malaysia record 91786 as its status source.
  status: {
    label: 'Listed as invasive in Malaysia',
    sourceLabel: 'GRIIS Malaysia',
    href: 'https://doi.org/10.15468/j9xkz3',
  },
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
  scan: {
    src: '/welcome/screen-scan.webp',
    width: 390,
    height: 825,
    alt: 'InvaTrace scan screen: take a photo of a plant or choose one from the gallery',
    placeholder: false,
  },
  prevent: {
    src: '/welcome/screen-prevent.webp',
    width: 390,
    height: 825,
    alt: 'InvaTrace catalogue page for mile-a-minute weed: documented impacts and safe response guidance',
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
    id: 'scan',
    title: 'Scan and report',
    detail: 'Photograph a plant to see what it is likely to be and whether it is invasive in Malaysia, then report where you found it.',
    screen: SCREENS.scan,
  },
  {
    id: 'prevent',
    title: 'Learn how to prevent and stop spread',
    detail: 'Look up each plant to see how it spreads, what not to do and when to leave removal to the land manager.',
    screen: SCREENS.prevent,
  },
  {
    id: 'community',
    title: 'Work together as a community',
    detail: 'Join or host a survey event and see what others in your community have reported nearby.',
    screen: SCREENS.events,
  },
] as const

// Two larger rows after the feature cards: before a walk and after it.
export const SPOTLIGHTS = [
  {
    id: 'know',
    title: 'Know what to look for',
    detail: 'Choose a mapped place and check its invasive plant watchlist before you set out.',
    screen: SCREENS.mission,
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
