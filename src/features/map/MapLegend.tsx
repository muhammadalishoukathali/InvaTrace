import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/Icon'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { PLACE_ICONS, PLACE_TYPES } from './place-icons'
import './map-controls.css'

/**
 * Legend that explains the pin colours on the threat map (hotspot/spreading/
 * isolated/removed). It floats over the map inside ThreatMapPage.tsx. On
 * desktop I just show the card inline in the bottom-left corner since there's
 * room for it. On mobile there isn't, so I collapse it down to a small
 * "Legend" pill that expands into a centered card above the scan button -
 * I wanted it to feel like a proper popover, not a tiny tooltip squashed
 * against the edge of the map.
 */
export function MapLegend() {
  const isDesktop = useIsDesktop()
  const [open, setOpen] = useState(isDesktop)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  // If someone resizes across the desktop breakpoint (or rotates a tablet),
  // I want open/collapsed to snap back to whatever that layout expects
  // instead of staying stuck in whichever state it happened to be in.
  useEffect(() => { setOpen(isDesktop) }, [isDesktop])

  // Let Escape close the mobile popover too, not just the close button.
  useEffect(() => {
    if (isDesktop || !open) return
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isDesktop, open])

  const close = () => {
    setOpen(false)
    window.requestAnimationFrame(() => toggleRef.current?.focus())
  }

  if (!isDesktop && !open) {
    return (
      <button
        type="button"
        ref={toggleRef}
        onClick={() => setOpen(true)}
        aria-label="Show map legend"
        aria-expanded="false"
        aria-controls="map-legend-card"
        className="map-legend-toggle"
      >
        <Icon name="Info" size={14} color="var(--body)" />
        Legend
      </button>
    )
  }

  const card = (
    <div
      role={isDesktop ? undefined : 'dialog'}
      aria-label={isDesktop ? undefined : 'Map legend'}
      aria-modal={isDesktop ? undefined : 'false'}
      id="map-legend-card"
      className={`map-legend-card${isDesktop ? '' : ' map-legend-card--popover'}`}
    >
      <div className="map-legend-card__header">
        <span className="map-legend-card__title">Legend</span>
        {!isDesktop && (
          <button
            type="button"
            ref={closeRef}
            onClick={close}
            aria-label="Hide legend"
            className="map-legend-card__close"
          >
            <Icon name="X" size={14} color="var(--muted)" />
          </button>
        )}
      </div>
      <Row colour="#C2412D" label="Hotspot (5+ reports)" />
      <Row colour="#D9880F" label="Spreading (2-4 reports)" />
      <Row colour="#2E7D3F" label="Isolated (1 report)" />
      <Row colour="#8B978F" label="Removed" muted />
      <div className="map-legend-card__divider" role="separator" aria-hidden />
      <span className="map-legend-card__subtitle">Mapped places</span>
      {PLACE_TYPES.map((placeType) => (
        <PlaceRow key={placeType} placeType={placeType} />
      ))}
      <p className="map-legend-card__note">
        Colour reflects how many community reports share the same spot.
        Reports appear once they pass automated checks.
      </p>
    </div>
  )

  // On mobile I add a light scrim behind the popover so tapping outside it
  // is actually discoverable as a way to close it, not just Escape/the X.
  if (!isDesktop) {
    return (
      <>
        <button
          type="button"
          onClick={close}
          aria-hidden
          tabIndex={-1}
          className="map-legend-scrim"
        />
        {card}
      </>
    )
  }

  return card
}

/** One colour-swatch + label row in the legend card. */
function Row({ colour, label, muted }: { colour: string; label: string; muted?: boolean }) {
  return (
    <div className="map-legend-card__row">
      <span aria-hidden className="map-legend-card__dot" style={{ background: colour, opacity: muted ? 0.65 : 1 }} />
      <span>{label}</span>
    </div>
  )
}

/**
 * Legend row for a mapped-place type. Uses the same SVG icon that the
 * map itself renders, so the legend and the map read as one system. The
 * icon is aria-hidden because the adjacent text label already carries
 * the name for screen readers.
 */
function PlaceRow({ placeType }: { placeType: keyof typeof PLACE_ICONS }) {
  const spec = PLACE_ICONS[placeType]
  return (
    <div className="map-legend-card__row">
      <span
        aria-hidden
        className="map-legend-card__glyph"
        // The raw SVG carries no external references and is authored in
        // this codebase (see place-icons.ts).
        dangerouslySetInnerHTML={{ __html: spec.svg }}
      />
      <span>{spec.label}</span>
    </div>
  )
}
