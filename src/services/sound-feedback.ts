export type FeedbackSound = 'scan' | 'saved' | 'removal' | 'followup'
const STORAGE_KEY = 'invatrace-sound-feedback-v1'
let context: AudioContext | null = null
let sessionPreference: boolean | undefined

export function soundFeedbackEnabled(): boolean {
  if (sessionPreference !== undefined) return sessionPreference
  try { return localStorage.getItem(STORAGE_KEY) === 'on' } catch { return false }
}

export function prepareSoundFeedback(): void {
  if (!soundFeedbackEnabled()) return
  try {
    if (!window.AudioContext) return
    if (!context || context.state === 'closed') context = new window.AudioContext()
    if (context.state === 'suspended') void context.resume().catch(() => {})
  } catch { /* Optional feedback must never interrupt a workflow. */ }
}

export function setSoundFeedbackEnabled(enabled: boolean): void {
  sessionPreference = enabled
  try { localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off') } catch { /* Keep the choice active for this tab when storage is blocked. */ }
  if (enabled) prepareSoundFeedback()
  else if (context) { const previous = context; context = null; void previous.close().catch(() => {}) }
}

/** Unlock audio on an intentional user gesture, before asynchronous requests finish. */
export function installSoundFeedback(): void {
  document.addEventListener('pointerdown', prepareSoundFeedback, { passive: true })
  document.addEventListener('click', prepareSoundFeedback, { passive: true })
  document.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') prepareSoundFeedback()
  })
}

export function playFeedbackSound(kind: FeedbackSound): void {
  if (!soundFeedbackEnabled()) return
  prepareSoundFeedback()
  if (!context) return
  const audio = context
  if (audio.state !== 'running') {
    void audio.resume().then(() => {
      if (soundFeedbackEnabled() && context === audio && audio.state === 'running') scheduleFeedbackSound(kind, audio)
    }).catch(() => {})
    return
  }
  scheduleFeedbackSound(kind, audio)
}

function scheduleFeedbackSound(kind: FeedbackSound, audio: AudioContext): void {
  try {
    const melodies: Record<FeedbackSound, [number, number][]> = {
      scan: [[740, 0], [990, .095]],
      saved: [[523.25, 0], [659.25, .12], [783.99, .25]],
      removal: [[523.25, 0], [659.25, .11], [783.99, .23], [1046.5, .38]],
      followup: [[659.25, 0], [783.99, .16]],
    }
    const notes = melodies[kind]
    notes.forEach(([frequency, delay], noteIndex) => {
      const time = audio.currentTime + .025 + delay
      const achievement = kind !== 'scan'
      const duration = achievement ? (noteIndex === notes.length - 1 ? .48 : .28) : .18
      const gain = audio.createGain()
      gain.gain.setValueAtTime(.00001, time)
      gain.gain.exponentialRampToValueAtTime(achievement ? .046 : .052, time + .006)
      gain.gain.exponentialRampToValueAtTime(.00001, time + duration)
      gain.connect(audio.destination)
      let remaining = achievement ? 3 : 2
      const ratios = achievement ? [1, 2, 2.76] : [1, 2.76]
      ratios.forEach((ratio, index) => {
        const oscillator = audio.createOscillator()
        const partial = audio.createGain()
        oscillator.type = 'sine'
        oscillator.frequency.setValueAtTime(frequency * ratio, time)
        oscillator.frequency.exponentialRampToValueAtTime(frequency * ratio * (achievement ? .995 : .96), time + duration)
        partial.gain.value = index === 0 ? 1 : index === 1 ? .17 : .07
        oscillator.connect(partial); partial.connect(gain)
        oscillator.onended = () => { oscillator.disconnect(); partial.disconnect(); if (--remaining === 0) gain.disconnect() }
        oscillator.start(time); oscillator.stop(time + duration + .02)
      })
    })
  } catch { /* Audio unavailable: keep the existing visual confirmation. */ }
}
