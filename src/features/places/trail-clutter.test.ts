import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

// Browse Places must not display trail records once the presentation-safe
// patch lands, even though /api/v1/places keeps returning them (backend
// contract is unchanged in this emergency patch).

function source(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
}

describe('Browse Places excludes trail records', () => {
  const page = source('./PlacesPage.tsx')

  it('filters out place.placeType === "trail" before the search term is applied', () => {
    const block = page.split('const places = useMemo(')[1]?.split('), [normalized')[0] ?? ''
    expect(block).toContain("place.placeType !== 'trail'")
  })

  it('updates the description and search copy to parks, forests and woodlands', () => {
    expect(page).toContain('Select a named park, forest or woodland to view historical occurrence associations.')
    expect(page).toContain('placeholder="Search park, forest or woodland"')
    expect(page).not.toContain('Select a named park, forest or trail')
    expect(page).not.toContain('placeholder="Search park, forest or trail"')
  })
})
