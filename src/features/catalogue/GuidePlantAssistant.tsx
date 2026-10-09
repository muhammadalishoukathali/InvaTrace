import { useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, Sparkles } from 'lucide-react'
import { useDialogA11y } from '@/hooks/useDialogA11y'
import { PlantAssistantPanel } from '@/features/scan/PlantAssistantPanel'
import '@/features/map/map-plant-assistant.css'

export function GuidePlantAssistant({ speciesId, scientificName }: {
  speciesId: string; scientificName: string
}) {
  const [open, setOpen] = useState(false)
  const hintId = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const dialog = useRef<HTMLElement>(null)
  useDialogA11y(dialog, () => setOpen(false), { active: open, returnFocus: () => trigger.current })
  return <>
    <button ref={trigger} type="button" className="guide-assistant-entry"
      aria-haspopup="dialog" aria-expanded={open} aria-describedby={hintId} onClick={() => setOpen(true)}>
      <span className="guide-assistant-entry__icon" aria-hidden="true"><Sparkles size={18} /></span>
      <span className="guide-assistant-entry__text">
        <span className="guide-assistant-entry__title">Ask Plant Assistant</span>
        <span id={hintId} className="guide-assistant-entry__hint">
          Identification, habitat or safe next steps for <i>{scientificName}</i>
        </span>
      </span>
      <ChevronRight className="guide-assistant-entry__chevron" size={18} aria-hidden="true" />
    </button>
    {open && createPortal(<>
      <div className="app-sheet-backdrop" aria-hidden onClick={() => setOpen(false)} />
      <aside ref={dialog} tabIndex={-1} role="dialog" aria-modal="true"
        aria-label="Guide Plant Assistant" className="map-plant-assistant">
        <PlantAssistantPanel initiallyOpen onClose={() => setOpen(false)}
          guideContext={{ speciesId, scientificName }} />
      </aside>
    </>, document.body)}
  </>
}
