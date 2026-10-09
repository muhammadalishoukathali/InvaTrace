import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/services/api-client'
import { useDialogA11y } from '@/hooks/useDialogA11y'
import { PlantAssistantHeader, PlantAssistantPanel } from '@/features/scan/PlantAssistantPanel'
import { findApprovedSpecies } from '@shared/catalogue'
import type { SightingDetail } from '@/types'
import './map-plant-assistant.css'

export function MapPlantAssistant({ sightingId, onClose }: {
  sightingId: string | null; onClose: () => void
}) {
  const dialog = useRef<HTMLElement>(null)
  useDialogA11y(dialog, onClose, {
    // Opened from a sighting sheet; fall back to the map controls if it closed.
    returnFocus: () => document.getElementById('sighting-assistant-entry') ?? document.getElementById('map-live-count'),
  })
  const { data, isLoading, isError } = useQuery({
    queryKey: ['sighting', sightingId],
    queryFn: () => api<SightingDetail>(`/api/v1/sightings/${sightingId}`),
    enabled: !!sightingId,
    staleTime: 0,
    retry: false,
  })
  const species = data && findApprovedSpecies({ speciesId: data.speciesId, scientificName: data.latinName })
  return createPortal(
    <>
      <div className="app-sheet-backdrop" aria-hidden onClick={onClose} />
      <aside ref={dialog} tabIndex={-1} role="dialog" aria-modal="true"
        aria-label="Map Plant Assistant" className="map-plant-assistant">
        {sightingId && !isLoading && !isError && species ? <PlantAssistantPanel
          key={`${sightingId}:${species.species_id}`} initiallyOpen onClose={onClose}
          mapContext={{ sightingId, speciesId: species.species_id, scientificName: species.scientific_name }}
        /> : <>
          <PlantAssistantHeader context="Map" onClose={onClose} />
          {sightingId ? <p className="plant-assistant__limitation" role="status">{isLoading ? 'Checking the public plant record…' : 'This record cannot provide supported plant context. Select a supported public plant record.'}</p>
            : <div className="plant-assistant__map-help">
              <p>Select a supported plant in the Reports list or on the map, then open this assistant for approved botanical information.</p>
              <p>Reports opens the visible community records. Places toggles mapped places. Browse opens the places list. Legend explains the marker colours. The existing filters control which reports are shown.</p>
              <p>Mapped reports are community observations. The assistant cannot confirm nearby plants, give directions or grant permission to enter, handle or remove plants.</p>
            </div>}
        </>}
      </aside>
    </>, document.body,
  )
}
