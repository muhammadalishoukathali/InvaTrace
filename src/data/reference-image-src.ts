import versions from 'virtual:reference-image-versions'

const PREFIX = '/reference-images/'

/** The URL to put in an <img> for a reviewed reference photo.
 *
 *  Reference images live at stable paths and are sometimes replaced in place.
 *  Appending a hash of the current file means a replaced photo gets a URL no
 *  browser or CDN has cached, so it reaches people who saw the old one. Any
 *  other URL (blob:, a reporter upload, an unknown file) is returned as-is. */
export function referenceImageSrc(url: string): string
export function referenceImageSrc(url: string | null | undefined): string | null
export function referenceImageSrc(url: string | null | undefined): string | null {
  if (!url) return url ?? null
  if (!url.startsWith(PREFIX) || url.includes('?')) return url
  const version = versions[url.slice(PREFIX.length)]
  return version ? `${url}?v=${version}` : url
}
