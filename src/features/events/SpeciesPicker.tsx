import { useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { approvedSpeciesDataset } from '@shared/catalogue'
import { Icon } from '@/components/Icon'
import { useDialogA11y } from '@/hooks/useDialogA11y'
import { speciesName } from './event-format'

/**
 * A searchable checklist for choosing target species. It replaces the native
 * multi-select box, which needed Ctrl/Cmd-click on a laptop and rendered as a
 * cramped scroll box on phones. Shown as a bottom sheet on mobile and a
 * centred dialog on larger screens.
 */
export function SpeciesPicker({ label, value, onChange, emptyLabel, disabled = false }: {
  label: string
  value: string[]
  onChange: (value: string[]) => void
  emptyLabel: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const labelId = useId()
  return (
    <div className="species-picker">
      <span id={labelId} className="species-picker__label">{label}</span>
      <button
        ref={buttonRef}
        type="button"
        className="species-picker__trigger"
        aria-labelledby={labelId}
        aria-describedby={`${labelId}-value`}
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Icon name="Leaf" size={17} />
        <span id={`${labelId}-value`}>{value.length === 0 ? emptyLabel : value.length === 1 ? speciesName(value[0]) : `${value.length} species selected`}</span>
        <Icon name="ChevronRight" size={17} />
      </button>
      {value.length > 0 && (
        <ul className="species-picker__chips" aria-label={`Selected ${label.toLowerCase()}`}>
          {value.map((id) => (
            <li key={id}>
              <button type="button" disabled={disabled} onClick={() => onChange(value.filter((item) => item !== id))} aria-label={`Remove ${speciesName(id)}`}>
                {speciesName(id)}
                <Icon name="X" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <SpeciesDialog
          title={label}
          initial={value}
          onClose={() => setOpen(false)}
          onApply={(next) => { onChange(next); setOpen(false) }}
          returnFocus={() => buttonRef.current}
        />
      )}
    </div>
  )
}

function SpeciesDialog({ title, initial, onClose, onApply, returnFocus }: {
  title: string
  initial: string[]
  onClose: () => void
  onApply: (value: string[]) => void
  returnFocus: () => HTMLElement | null
}) {
  const [selected, setSelected] = useState(() => new Set(initial))
  const [search, setSearch] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useDialogA11y(dialogRef, onClose, { returnFocus })
  const records = useMemo(() => {
    const term = search.trim().toLowerCase()
    const all = [...approvedSpeciesDataset.records]
      .sort((a, b) => (a.common_names[0] ?? a.scientific_name).localeCompare(b.common_names[0] ?? b.scientific_name))
    return term
      ? all.filter((item) => [item.scientific_name, ...item.common_names].some((name) => name.toLowerCase().includes(term)))
      : all
  }, [search])
  const toggle = (id: string) => setSelected((previous) => {
    const next = new Set(previous)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  return createPortal(
    <div className="event-sheet">
      <div className="event-sheet__scrim" onClick={onClose} />
      <div ref={dialogRef} className="event-sheet__panel" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className="event-sheet__header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="event-icon-button" onClick={onClose} aria-label="Close">
            <Icon name="X" size={20} />
          </button>
        </header>
        <label className="species-search">
          <Icon name="Search" size={17} />
          <span className="sr-only">Search species</span>
          <input data-dialog-initial type="search" value={search} placeholder="Search by common or scientific name" onChange={(event) => setSearch(event.target.value)} />
        </label>
        <p className="species-dialog__count" role="status">{selected.size} selected · {records.length} shown</p>
        <ul className="species-dialog__list">
          {records.map((item) => (
            <li key={item.species_id}>
              <label>
                <input type="checkbox" checked={selected.has(item.species_id)} onChange={() => toggle(item.species_id)} />
                <span>
                  <strong>{item.common_names[0] ?? item.scientific_name}</strong>
                  <i>{item.scientific_name}</i>
                </span>
              </label>
            </li>
          ))}
          {records.length === 0 && <li className="species-dialog__empty">No species match “{search}”.</li>}
        </ul>
        <footer className="event-sheet__footer">
          <button type="button" className="event-button" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>Clear</button>
          <button type="button" className="event-button event-button--primary" onClick={() => onApply([...selected])}>
            {selected.size ? `Apply ${selected.size}` : 'Apply'}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
