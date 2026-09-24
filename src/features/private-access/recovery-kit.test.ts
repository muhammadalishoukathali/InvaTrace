import { describe, expect, it } from 'vitest'
import { copyText, recoveryKitBlob, recoveryKitFileName, recoveryKitText } from './recovery-kit'

describe('recovery kit', () => {
  it('contains the public identifier, the code, date, and reusable-code note as UTF-8 text', () => {
    const text = recoveryKitText({
      profileId: 'A3F8K2',
      recoveryCodes: ['AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GG'],
      createdAt: new Date('2026-08-28T10:00:00.000Z'),
    })
    expect(text).toContain('InvaTrace private access recovery kit')
    expect(text).toContain('Public profile ID: A3F8K2')
    expect(text).toContain('2026-08-28T10:00:00.000Z')
    expect(text).toContain('AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GG')
    // Singular framing for the one-code case.
    expect(text).toContain('This recovery code stays valid')
    expect(text).toContain('can be used any number of times')
    expect(new TextEncoder().encode(text).byteLength).toBeGreaterThan(text.length)
  })

  it('falls back to selection-based copy when Clipboard API permission is denied', async () => {
    let fallbackText = ''
    await copyText('private recovery text', {
      writeClipboard: async () => { throw new Error('permission denied') },
      legacyCopy: (text) => { fallbackText = text; return true },
    })
    expect(fallbackText).toBe('private recovery text')
  })

  it('reports an actionable error when neither copy method works', async () => {
    await expect(copyText('private recovery text', {
      writeClipboard: async () => { throw new Error('permission denied') },
      legacyCopy: () => false,
    })).rejects.toThrow('use Download recovery kit')
  })

  it('downloads a named UTF-8 text file with a byte-order marker', async () => {
    const input = {
      profileId: 'A3F8K2',
      recoveryCodes: ['AAAA-BBBB-CCCC'],
      createdAt: new Date('2026-08-28T10:00:00.000Z'),
    }
    const bytes = new Uint8Array(await recoveryKitBlob(input).arrayBuffer())
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xEF, 0xBB, 0xBF])
    expect(recoveryKitFileName(input.profileId)).toBe('invatrace-recovery-kit-A3F8K2.txt')
  })
})
