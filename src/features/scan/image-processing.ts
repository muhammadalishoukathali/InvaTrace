/**
 * Gets a captured or picked photo ready before the model ever touches it —
 * checks it's a real, non-empty image of a type we accept, scales it down to
 * a sane max dimension and re-encodes it as JPEG, and also hands back a cheap
 * hash that the dev-mode fake model uses and I use for quick duplicate
 * checks. The actual per-model resize/crop/normalize step happens later on,
 * in pulih-model.ts — this file's only job is getting a reasonably-sized,
 * well-formed blob ready to hand off to that.
 */
const MAX_SIDE = 1024
export const MAX_SOURCE_BYTES = 10 * 1024 * 1024
export const ACCEPTED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const
export const ACCEPTED_IMAGE_ATTR = ACCEPTED_IMAGE_MIME.join(',')

export function isAcceptedImageType(file: Blob): boolean {
  return (ACCEPTED_IMAGE_MIME as readonly string[]).includes(file.type)
}

type ResizeCanvas = OffscreenCanvas | HTMLCanvasElement

function createCanvas(width: number, height: number): ResizeCanvas {
  if ('OffscreenCanvas' in globalThis) return new OffscreenCanvas(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function canvasToJpeg(canvas: ResizeCanvas): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
  }
  const htmlCanvas = canvas as HTMLCanvasElement
  return new Promise((resolve, reject) => {
    htmlCanvas.toBlob(
      (blob: Blob | null) => blob
        ? resolve(blob)
        : reject(new Error('The resized photo could not be encoded.')),
      'image/jpeg',
      0.85,
    )
  })
}

export async function resizeImage(file: Blob): Promise<{ bitmap: ImageBitmap; url: string; blob: Blob }> {
  if (file.size === 0) {
    throw new Error('Photo file is empty. Retake the photo and try again.')
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error('Photo is too large. Choose an image smaller than 10 MB.')
  }
  if (!isAcceptedImageType(file)) {
    throw new Error('Unsupported image format. Use JPEG, PNG or WebP.')
  }
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  let blob: Blob
  try {
    if (bitmap.width < 1 || bitmap.height < 1) throw new Error('Photo has invalid dimensions.')
    // Only ever scales down, never up — upscaling a small photo would just add
    // fake detail that isn't really there. Full-res phone photos (12+ MP) are
    // way more than the model needs anyway, and just slow down both the
    // upload and the later on-device crop for no benefit.
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = createCanvas(width, height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('A 2D canvas is required to resize the photo.')
    context.drawImage(bitmap, 0, 0, width, height)
    blob = await canvasToJpeg(canvas)
  } finally {
    bitmap.close()
  }
  // Re-decoding the JPEG I just produced, instead of just reusing the original
  // bitmap, is what guarantees the ImageBitmap handed back actually matches
  // the pixels (and dimensions) of the blob that ends up uploaded/stored.
  const resized = await createImageBitmap(blob, { imageOrientation: 'from-image' })
  const url = URL.createObjectURL(blob)
  return { bitmap: resized, url, blob }
}

// This is just a cheap 8x8-pixel hash, not an actual perceptual hash — good
// enough to pick a deterministic "random" bucket for the dev-mode fake model
// and jitter the mock quality-check failures, but not reliable enough to
// use for spotting real duplicate photos.
export function hashBitmap(bitmap: ImageBitmap): number {
  const canvas = createCanvas(8, 8)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('A 2D canvas is required to inspect the photo.')
  context.drawImage(bitmap, 0, 0, 8, 8)
  const data = context.getImageData(0, 0, 8, 8).data
  let h = 0
  for (let i = 0; i < data.length; i += 4) {
    h = ((h << 5) - h + data[i]) | 0
  }
  return Math.abs(h)
}
