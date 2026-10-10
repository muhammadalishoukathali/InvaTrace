import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@/components/Icon'
import { useDialogA11y } from '@/hooks/useDialogA11y'
import { PLACE_ICONS, PUBLIC_PLACE_TYPES } from './place-icons'
import './map-controls.css'

/**
 * Pin-colour legend for the threat map. Renders as a chip in the map
 * controls cluster and opens a centered popover with a scrim on tap.
 * The popover is portalled to document.body because the cluster uses
 * backdrop-filter, which creates a containing block for fixed elements
 * and would trap the popover inside the cluster's bounding box.
 */
export function MapLegend() {
  const [open, setOpen] = useState(false)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  const close = () => {
    setOpen(false)
  }
  useDialogA11y(dialogRef, close, { active: open, returnFocus: () => toggleRef.current })

  return (
    <>
      <button
        type="button"
        ref={toggleRef}
        onClick={() => setOpen(true)}
        aria-label="Show map legend"
        aria-expanded={open}
        aria-controls="map-legend-card"
        className="map-legend-toggle"
      >
        <Icon name="Info" size={14} color="currentColor" />
        <span>Legend</span>
      </button>
      {open && createPortal(
        <>
          {/* A div like every other backdrop: a <button> would pick up the
              global hover/pressed button effects across the whole screen. */}
          <div onClick={close} aria-hidden className="map-legend-scrim" />
          <div
            ref={dialogRef}
            tabIndex={-1}
            role="dialog"
            aria-label="Map legend"
            aria-modal="true"
            id="map-legend-card"
            className="map-legend-card map-legend-card--popover"
          >
            <div className="map-legend-card__header">
              <span className="map-legend-card__title">Legend</span>
              <button
                type="button"
                onClick={close}
                aria-label="Hide legend"
                className="map-legend-card__close"
              >
                <Icon name="X" size={14} color="var(--muted)" />
              </button>
            </div>
            <Row colour="#C2412D" label="Hotspot (5+ reports)" />
            <Row colour="#D9880F" label="Spreading (2-4 reports)" />
            <Row colour="#2E7D3F" label="Isolated (1 report)" />
            <Row colour="#66736D" label="Removal reported · Follow-up needed" muted />
            <Row colour="#8B978F" label="Resolved after follow-up · No regrowth" muted />
            <div className="map-legend-card__divider" role="separator" aria-hidden />
            <span className="map-legend-card__subtitle">Mapped places</span>
            {PUBLIC_PLACE_TYPES.map((placeType) => (
              <PlaceRow key={placeType} placeType={placeType} />
            ))}
            <p className="map-legend-card__note">
              Colour reflects how many community reports share the same spot.
              Reports appear once they pass automated checks. Resolved markers
              are hidden unless you filter for them; reported regrowth returns
              a marker to its colour.
            </p>
          </div>
        </>,
        document.body,
      )}
    </>
  )
}

function Row({ colour, label, muted }: { colour: string; label: string; muted?: boolean }) {
  return (
    <div className="map-legend-card__row">
      <span aria-hidden className="map-legend-card__dot" style={{ background: colour, opacity: muted ? 0.65 : 1 }} />
      <span>{label}</span>
    </div>
  )
}

function PlaceRow({ placeType }: { placeType: keyof typeof PLACE_ICONS }) {
  const spec = PLACE_ICONS[placeType]
  return (
    <div className="map-legend-card__row">
      <span
        aria-hidden
        className="map-legend-card__glyph"
        dangerouslySetInnerHTML={{ __html: spec.svg }}
      />
      <span>{spec.label}</span>
    </div>
  )
}
