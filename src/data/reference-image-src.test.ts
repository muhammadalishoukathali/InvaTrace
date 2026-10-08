import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import versions from 'virtual:reference-image-versions'
import { referenceImageSrc } from './reference-image-src'

const imageDir = new URL('../../public/reference-images/', import.meta.url)

function shortHash(name: string): string {
  return createHash('sha256').update(readFileSync(new URL(name, imageDir))).digest('hex').slice(0, 12)
}

describe('referenceImageSrc', () => {
  it('versions a reference photo by the hash of its current bytes', () => {
    // Mikania micrantha was replaced in place; the new photo must get a URL
    // that no browser cached under the old one.
    expect(referenceImageSrc('/reference-images/mikania_micrantha.jpg'))
      .toBe(`/reference-images/mikania_micrantha.jpg?v=${shortHash('mikania_micrantha.jpg')}`)
  })

  it('has a version for every published reference photo', () => {
    const published = readdirSync(imageDir).filter((name) => name.endsWith('.jpg'))
    expect(Object.keys(versions).sort()).toEqual(expect.arrayContaining(published))
    for (const name of published) expect(versions[name]).toBe(shortHash(name))
  })

  it('leaves other URLs alone', () => {
    expect(referenceImageSrc('blob:http://localhost/abc')).toBe('blob:http://localhost/abc')
    expect(referenceImageSrc('https://cdn.example/photo.jpg')).toBe('https://cdn.example/photo.jpg')
    expect(referenceImageSrc('/reference-images/not-a-real-file.jpg')).toBe('/reference-images/not-a-real-file.jpg')
    expect(referenceImageSrc('/reference-images/mikania_micrantha.jpg?v=pinned'))
      .toBe('/reference-images/mikania_micrantha.jpg?v=pinned')
    expect(referenceImageSrc(null)).toBeNull()
    expect(referenceImageSrc(undefined)).toBeNull()
  })
})
