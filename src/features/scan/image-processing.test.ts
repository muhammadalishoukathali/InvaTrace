import { describe, expect, it } from 'vitest'
import {
  ACCEPTED_IMAGE_ATTR,
  MAX_SOURCE_BYTES,
  isAcceptedImageType,
  resizeImage,
} from './image-processing'

describe('scan image input validation', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp'])('accepts %s', (type) => {
    expect(isAcceptedImageType(new Blob(['photo'], { type }))).toBe(true)
  })

  it('publishes the same image types for file input filtering', () => {
    expect(ACCEPTED_IMAGE_ATTR).toBe('image/jpeg,image/png,image/webp')
  })

  it('rejects an empty file before decoding', async () => {
    await expect(resizeImage(new Blob([], { type: 'image/jpeg' })))
      .rejects.toThrow('Photo file is empty')
  })

  it('rejects oversized input before decoding', async () => {
    const oversized = new Blob([new Uint8Array(MAX_SOURCE_BYTES + 1)], { type: 'image/jpeg' })
    await expect(resizeImage(oversized)).rejects.toThrow('no larger than 10 MB')
  })

  it('rejects unsupported image formats before decoding', async () => {
    await expect(resizeImage(new Blob(['gif'], { type: 'image/gif' })))
      .rejects.toThrow('Unsupported image format')
  })
})
