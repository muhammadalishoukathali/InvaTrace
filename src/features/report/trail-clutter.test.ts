import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

// A trail returned by /api/v1/places/at-location must not produce a new
// "Adopt this area for monitoring?" prompt, while an already-existing
// adoption keeps rendering on My Adopted Areas untouched (out of scope here).

function source(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
}

describe('adoption prompt only for public place types', () => {
  const page = source('./ReportTrackingPage.tsx')

  it('imports PUBLIC_PLACE_TYPES and gates the adoption section on it', () => {
    expect(page).toContain("import { PUBLIC_PLACE_TYPES } from '@/features/map/place-icons'")
    const block = page.split('report-adoption-heading')[0]
    expect(block).toContain('adoptionPlace.data?.place')
    expect(block).toContain('(PUBLIC_PLACE_TYPES as readonly string[]).includes(adoptionPlace.data.place.placeType)')
  })
})
