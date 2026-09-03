/**
 * Holds the active map filters and whatever sighting is currently selected.
 * I deliberately kept this out of the URL - every filter tap would otherwise
 * push a new browser-history entry, which means Back would just undo filters
 * one at a time instead of leaving the map.
 *
 * I also pulled this out of ThreatMapPage.tsx rather than just using
 * useState there, because MapFilters.tsx and SightingDetailsSheet.tsx both
 * need to read and write the same state and neither is a child of the
 * other, so prop drilling through the page component would've been messy.
 */
import { create } from 'zustand'
import type { SightingStatus, Risk } from '@/types'

interface MapState {
  species: string[]                // empty = every species shown
  statuses: SightingStatus[]       // empty = every status shown
  risks: Risk[]                    // empty = every risk level shown
  search: string
  selectedId: string | null

  toggleSpecies: (id: string) => void
  toggleStatus: (s: SightingStatus) => void
  toggleRisk: (r: Risk) => void
  clearFilters: () => void
  setSearch: (q: string) => void
  select: (id: string | null) => void
}

export const useMapView = create<MapState>((set, get) => ({
  species: [],
  statuses: [],
  risks: [],
  search: '',
  selectedId: null,

  toggleSpecies: (id) => {
    const cur = get().species
    set({ species: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] })
  },

  toggleStatus: (s) => {
    const cur = get().statuses
    set({ statuses: cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s] })
  },

  toggleRisk: (r) => {
    const cur = get().risks
    set({ risks: cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r] })
  },

  clearFilters: () => set({ species: [], statuses: [], risks: [], search: '' }),

  setSearch: (q) => set({ search: q }),

  select: (id) => set({ selectedId: id }),
}))
