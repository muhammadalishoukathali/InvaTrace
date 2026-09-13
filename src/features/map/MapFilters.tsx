import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@/components/Icon'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { useMapView } from '@/features/map/map-view-store'
import { useDialogA11y } from '@/hooks/useDialogA11y'
import { approvedSpeciesDataset } from '@shared/catalogue'
import type { SightingStatus, Risk } from '@/types'
import './map-controls.css'

/** Public map filters use the closed business catalogue, independent of the
 *  currently bundled classifier's older class list. */
export const MAP_FILTER_SPECIES = approvedSpeciesDataset.records
  .map((species) => ({
    id: species.species_id,
    label: species.common_names[0],
  }))

const STATUSES: { id: SightingStatus; label: string; dot?: string }[] = [
  { id: 'screened', label: 'Rule screened' },
  { id: 'removal_reported', label: 'Removal reported', dot: '#8B978F' },
  { id: 'removed', label: 'Removed (legacy)', dot: '#65736C' },
]

const RISKS: { id: Risk; label: string; dot: string }[] = [
  { id: 'high', label: 'High risk', dot: '#C2412D' },
  { id: 'watch', label: 'Watch', dot: '#D9880F' },
]

/**
 * Search box plus the species/risk/status filter chips that sit above the
 * threat map. I kept the actual filter state out of this component and put
 * it in map-view-store.ts instead, because the map's marker-rebuild effect
 * in ThreatMapPage.tsx needs to read the same values and I didn't want to
 * prop-drill between two components that aren't parent/child. On desktop
 * there's enough room to lay the chips out inline; on mobile they wouldn't
 * fit in one row so I move them into a bottom sheet instead.
 */
export function MapFilters() {
  const isDesktop = useIsDesktop()
  const [sheetOpen, setSheetOpen] = useState(false)
  const {
    species, statuses, risks, search, setSearch,
    toggleSpecies, toggleStatus, toggleRisk, clearFilters,
  } = useMapView()
  const active = species.length + statuses.length + risks.length

  return (
    <div className="map-toolbar">
      {/* Search box stays visible no matter the screen size. On mobile the
          filter button below opens the same choices in a bottom sheet since
          the chips would overflow if I tried to cram them into one row. */}
      <div className="map-toolbar__row">
        <label className="field-shell map-search" style={{
          display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0,
          height: 'var(--h-nav)', paddingLeft: 11,
        }}>
          <span aria-hidden style={{ display: 'flex', flexShrink: 0 }}>
            <Icon name="Search" size={16} color="var(--muted)" />
          </span>
          <input
            type="search"
            aria-label="Search species"
            className="field-control"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search species…"
            style={{
              flex: 1, height: '100%', padding: 0, paddingRight: search ? 0 : 12,
              border: 'none', outline: 'none',
              background: 'transparent', fontSize: 14, color: 'var(--ink)',
            }}
          />
          {search && (
            <button type="button" onClick={() => setSearch('')} aria-label="Clear search" style={{
              width: 42, height: 42, borderRadius: '50%', border: 'none',
              background: 'transparent', cursor: 'pointer', padding: 0, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Icon name="X" size={14} color="var(--muted)" />
            </button>
          )}
        </label>

        {!isDesktop && (
          <button type="button" onClick={() => setSheetOpen(true)} aria-haspopup="dialog"
            aria-expanded={sheetOpen} aria-controls="map-filters-sheet"
            className={`map-filter-trigger${active > 0 ? ' map-filter-trigger--active' : ''}`}>
            <Icon name="SlidersHorizontal" size={16}
                  color={active > 0 ? 'var(--green)' : 'var(--body)'} />
            Filters{active > 0 ? ` · ${active}` : ''}
          </button>
        )}
      </div>

      {/* Desktop has enough width to lay out every filter as an inline chip.
          I grouped each chip cluster with role="group" and an aria-label for
          AC Iteration 1 P9 (accessibility) - without that a screen-reader
          user just hears a long run of pressed/not-pressed buttons with no
          way to tell "Species filters" apart from "Risk filters". */}
      {isDesktop && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <div role="group" aria-label="Species filters" style={{ display: 'contents' }}>
            {MAP_FILTER_SPECIES.map((s) => (
              <Chip key={s.id} label={s.label} on={species.includes(s.id)}
                    onClick={() => toggleSpecies(s.id)} />
            ))}
          </div>
          <Divider />
          <div role="group" aria-label="Risk filters" style={{ display: 'contents' }}>
            {RISKS.map((r) => (
              <Chip key={r.id} label={r.label} on={risks.includes(r.id)} dot={r.dot}
                    onClick={() => toggleRisk(r.id)} />
            ))}
          </div>
          <Divider />
          <div role="group" aria-label="Status filters" style={{ display: 'contents' }}>
            {STATUSES.map((s) => (
              <Chip key={s.id} label={s.label} on={statuses.includes(s.id)} dot={s.dot}
                    onClick={() => toggleStatus(s.id)} />
            ))}
          </div>
          {active > 0 && (
            <button type="button" onClick={clearFilters} style={{
              marginLeft: 'auto', padding: '0 10px', height: 'var(--h-chip)',
              borderRadius: 'var(--r-chip)', border: 'none',
              background: 'transparent', color: 'var(--muted)',
              fontSize: 12, fontWeight: 500, cursor: 'pointer',
            }}>
              Clear ({active})
            </button>
          )}
        </div>
      )}

      {/* Mobile gets the same filter choices, just rendered inside a
          keyboard-accessible dialog instead of an inline row. */}
      {!isDesktop && sheetOpen && (
        <FiltersSheet
          onClose={() => setSheetOpen(false)}
          selectedSpecies={species}
          selectedStatuses={statuses}
          selectedRisks={risks}
          toggleSpecies={toggleSpecies}
          toggleStatus={toggleStatus}
          toggleRisk={toggleRisk}
          clearFilters={clearFilters}
          active={active}
        />
      )}
    </div>
  )
}

/** Just a thin vertical rule so the desktop chip groups don't blur together. */
function Divider() {
  return <span aria-hidden style={{
    width: 1, height: 22, background: 'var(--border)', margin: '0 4px',
  }} />
}

/** Mobile-only bottom sheet with the same filter controls, opened from the
 *  "Filters" button up top once the screen is too narrow for inline chips. */
function FiltersSheet({
  onClose, selectedSpecies, selectedStatuses, selectedRisks,
  toggleSpecies, toggleStatus, toggleRisk, clearFilters, active,
}: {
  onClose: () => void
  selectedSpecies: readonly string[]
  selectedStatuses: readonly SightingStatus[]
  selectedRisks: readonly Risk[]
  toggleSpecies: (id: string) => void
  toggleStatus: (s: SightingStatus) => void
  toggleRisk: (r: Risk) => void
  clearFilters: () => void
  active: number
}) {
  const dialogRef = useRef<HTMLElement>(null)
  useDialogA11y(dialogRef, onClose)

  /* I portal this into document.body so the map canvas and its controls can
   * never sneak above the sheet - the map container sets up its own stacking
   * context, so without the portal the sheet would end up stuck behind it. */
  return createPortal(
    <>
      <div onClick={onClose} aria-hidden className="app-sheet-backdrop" />
      <aside ref={dialogRef} id="map-filters-sheet" tabIndex={-1}
        role="dialog" aria-label="Filters" aria-modal="true"
        className="app-sheet map-filter-sheet">
        <div className="app-sheet__handle" aria-hidden />
        <header className="app-sheet__header">
          <div className="app-sheet__heading">
            <h2 tabIndex={-1} data-dialog-initial className="app-sheet__title">Filter sightings</h2>
            <p className="app-sheet__subtitle">
              {active === 0 ? 'All map records are visible' : `${active} filter${active === 1 ? '' : 's'} active`}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close filters" className="app-sheet__close">
            <Icon name="X" size={18} color="var(--body)" />
          </button>
        </header>

        <div className="app-sheet__body map-filter-sheet__body">
          <FilterGroup title="Risk level" description="Prioritize the most urgent sightings.">
            <div className="filter-option-grid">
            {RISKS.map((r) => (
                <FilterOption key={r.id} label={r.label} on={selectedRisks.includes(r.id)} dot={r.dot}
                              onClick={() => toggleRisk(r.id)} />
            ))}
            </div>
          </FilterGroup>
          <FilterGroup title="Species" description="Choose one or more tracked plants.">
            <div className="filter-option-grid">
            {MAP_FILTER_SPECIES.map((s) => (
                <FilterOption key={s.id} label={s.label} on={selectedSpecies.includes(s.id)}
                              onClick={() => toggleSpecies(s.id)} />
            ))}
            </div>
          </FilterGroup>
          <FilterGroup title="Status" description="Show rule-screened or already removed plants.">
            <div className="filter-option-grid filter-option-grid--status">
            {STATUSES.map((s) => (
                <FilterOption key={s.id} label={s.label} on={selectedStatuses.includes(s.id)} dot={s.dot}
                              onClick={() => toggleStatus(s.id)} />
            ))}
            </div>
          </FilterGroup>
        </div>

        <div className="app-sheet__footer map-filter-sheet__footer">
          <button type="button" onClick={clearFilters} disabled={active === 0}
            className="map-filter-sheet__reset">
            Reset
          </button>
          <button type="button" onClick={onClose} className="map-filter-sheet__apply">
            Show results
          </button>
        </div>
      </aside>
    </>,
    document.body,
  )
}

/** One labelled section (Risk level / Species / Status) in the mobile filter sheet. */
function FilterGroup({ title, description, children }: {
  title: string; description: string; children: React.ReactNode
}) {
  return (
    <section className="filter-group">
      <div className="filter-group__heading">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      {children}
    </section>
  )
}

/** One toggleable row inside a mobile FilterGroup - e.g. a single species checkbox. */
function FilterOption({ label, on, onClick, dot }: {
  label: string; on: boolean; onClick: () => void; dot?: string
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={`filter-option${on ? ' filter-option--selected' : ''}`}>
      <span className="filter-option__label">
        {dot && <span aria-hidden className="filter-option__dot" style={{ background: dot }} />}
        <span>{label}</span>
      </span>
      <span aria-hidden className="filter-option__check">
        {on && <Icon name="Check" size={13} color="#fff" strokeWidth={2.4} />}
      </span>
    </button>
  )
}

/** Toggleable pill for the desktop inline filter bar (species/risk/status). */
function Chip({ label, on, onClick, dot }: {
  label: string; on: boolean; onClick: () => void; dot?: string
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={`map-filter-chip${on ? ' map-filter-chip--selected' : ''}`}>
      {dot && (
        <span aria-hidden style={{
          width: 8, height: 8, borderRadius: '50%', background: dot,
          boxShadow: '0 0 0 1.5px #fff, 0 0 0 2.5px var(--border)',
        }} />
      )}
      {label}
    </button>
  )
}
