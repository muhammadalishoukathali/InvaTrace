import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('optional achievement sounds', () => {
  let storage: Map<string, string>
  let oscillators: { start: ReturnType<typeof vi.fn> }[]
  let AudioCtor: ReturnType<typeof vi.fn>
  beforeEach(() => {
    vi.resetModules(); storage = new Map(); oscillators = []
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key), setItem: (key: string, value: string) => storage.set(key, value) })
    const parameter = () => ({ value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() })
    AudioCtor = vi.fn(function () {
      return { state: 'running', currentTime: 0, destination: {}, resume: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
        createGain: () => ({ gain: parameter(), connect: vi.fn(), disconnect: vi.fn() }),
        createOscillator: () => { const node = { type: 'sine', frequency: parameter(), connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null }; oscillators.push(node); return node },
      }
    })
    vi.stubGlobal('window', { AudioContext: AudioCtor })
  })
  afterEach(() => vi.unstubAllGlobals())
  it('starts muted and creates no audio context for normal actions', async () => {
    const api = await import('./sound-feedback')
    api.prepareSoundFeedback(); api.playFeedbackSound('saved')
    expect(api.soundFeedbackEnabled()).toBe(false); expect(AudioCtor).not.toHaveBeenCalled()
  })
  it.each([['saved', 9], ['removal', 12], ['followup', 6]] as const)('plays the %s melody only when enabled', async (kind, count) => {
    const api = await import('./sound-feedback')
    api.setSoundFeedbackEnabled(true); api.playFeedbackSound(kind)
    expect(oscillators).toHaveLength(count)
    expect(oscillators.every(node => node.start.mock.calls.length === 1)).toBe(true)
    api.setSoundFeedbackEnabled(false); api.playFeedbackSound(kind)
    expect(oscillators).toHaveLength(count)
  })
  it('cannot interrupt a saved report when audio or storage is unavailable', async () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('unavailable') }, setItem: () => { throw new Error('unavailable') } })
    const api = await import('./sound-feedback')
    expect(() => { api.setSoundFeedbackEnabled(true); api.prepareSoundFeedback(); api.playFeedbackSound('saved') }).not.toThrow()
    expect(api.soundFeedbackEnabled()).toBe(true)
    expect(oscillators).toHaveLength(9)
  })
  it('resumes audio suspended while waiting for a save', async () => {
    const api = await import('./sound-feedback')
    api.setSoundFeedbackEnabled(true)
    const audio = AudioCtor.mock.results[0].value
    audio.state = 'suspended'
    audio.resume.mockImplementation(async () => { audio.state = 'running' })
    api.playFeedbackSound('followup')
    await Promise.resolve()
    expect(audio.resume).toHaveBeenCalled()
    expect(oscillators).toHaveLength(6)
  })
  it('does not play a pending sound after the user mutes it', async () => {
    const api = await import('./sound-feedback')
    api.setSoundFeedbackEnabled(true)
    const audio = AudioCtor.mock.results[0].value
    audio.state = 'suspended'
    let finish!: () => void
    const resumed = new Promise<void>(resolve => { finish = resolve })
    audio.resume.mockImplementation(() => resumed)
    api.playFeedbackSound('saved')
    api.setSoundFeedbackEnabled(false)
    audio.state = 'running'; finish()
    await Promise.resolve()
    expect(oscillators).toHaveLength(0)
  })
  it('cannot interrupt a workflow when the audio device fails', async () => {
    AudioCtor.mockImplementation(() => { throw new Error('no audio device') })
    const api = await import('./sound-feedback')
    expect(() => { api.setSoundFeedbackEnabled(true); api.playFeedbackSound('removal') }).not.toThrow()
  })
})
