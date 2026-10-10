import { useState } from 'react'
import { playFeedbackSound, setSoundFeedbackEnabled, soundFeedbackEnabled } from '@/services/sound-feedback'

export function SoundFeedbackPreference() {
  const [enabled, setEnabled] = useState(soundFeedbackEnabled)
  return <label className="sound-feedback-preference">
    <input type="checkbox" checked={enabled} onChange={event => {
      setSoundFeedbackEnabled(event.target.checked); setEnabled(soundFeedbackEnabled())
      if (event.target.checked) playFeedbackSound('saved')
    }} />
    <span>Play soft sounds after scans, saved reports, removals and follow-ups (plays a preview when enabled)</span>
  </label>
}
