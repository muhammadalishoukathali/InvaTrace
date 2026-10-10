import { PlantLoader } from '@/components/PlantLoader'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { approvedCatalogueAssetForSpecies, findApprovedSpecies } from '@shared/catalogue'
import { BackLink } from '@/components/BackLink'
import { Icon } from '@/components/Icon'
import { useDialogA11y } from '@/hooks/useDialogA11y'
import { useOnline } from '@/hooks/useOnline'
import { usePrivateAccess } from '@/features/private-access/private-access-store'
import { api, ApiError } from '@/services/api-client'
import { guidedMissionsApi, type GuidedMission, type MissionPlantState, type MissionSummary } from '@/services/api/guided-missions'
import type { PlaceDetail, PlacePlantAssociationsResponse } from '@/types'
import { ENGLISH_LOCALE } from '@/utils/date-time'
import { GuidedMissionMap } from './GuidedMissionMap'
import {
  HABITAT_COLOURS, HABITAT_DATASET_VERSION, bboxToBounds, compatibleHabitats, legendFor, plantsForHabitat,
  resolveHabitatEntry, useHabitatIndex, useHabitatLookup, useHabitatOverlay, useHabitatRelease, visibleFeatures,
  type HabitatCategory, type HabitatOverlay,
} from './habitat-data'
import { missionContextStore, missionPath } from './mission-context'
import { isRetryable, pendingCount, pendingMissionStore, usePendingMissionChanges, withPending } from './mission-offline'
import './guided-missions.css'
import { referenceImageSrc } from '@/data/reference-image-src'

const SEARCH_GUIDANCE = 'Suggested area to search - plant presence is not confirmed.'
const STATE_LABELS: Record<MissionPlantState, string> = { not_checked: 'Not checked', looked_for: 'Looked for', unable_to_check: 'Unable to check' }

interface WatchlistPlant { speciesId: string; name: string; scientificName: string; image: string | null; habitats: HabitatCategory[] }

/**
 * Epic 7 guided habitat search mission for one place (route
 * /places/:placeId/mission). Highlights mapped habitat categories that suit the
 * place's watchlist plants. It never scores, ranks or predicts - a highlight is
 * a compatible habitat, nothing more.
 */
export function GuidedMissionPage() {
  const { placeId = '' } = useParams()
  const navigate = useNavigate()
  const cache = useQueryClient()
  const profileId = usePrivateAccess((state) => state.profile?.id)
  const index = useHabitatIndex()
  const lookup = useHabitatLookup()
  const place = useQuery({ queryKey: ['place', placeId], queryFn: () => api<PlaceDetail>(`/api/v1/places/${placeId}`), enabled: Boolean(placeId) })
  const associations = useQuery({
    queryKey: ['place-associations', placeId],
    queryFn: () => api<PlacePlantAssociationsResponse>(`/api/v1/places/${placeId}/plant-associations`),
    enabled: Boolean(placeId),
  })
  const entry = index.data ? resolveHabitatEntry(index.data.byId, placeId, place.data) : null
  const overlay = useHabitatOverlay(entry)
  const mission = useQuery({
    queryKey: ['guided-mission', placeId],
    queryFn: async () => {
      try { return await guidedMissionsApi.active(placeId) } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null
        throw error
      }
    },
    enabled: Boolean(placeId && entry),
    // Always refetch on return from the scan/report flow so a report or scan
    // made there shows in the progress straight away (AC 7.4.3).
    staleTime: 0,
    refetchOnMount: 'always',
  })
  const online = useOnline()
  const missionId = mission.data?.missionId ?? null
  const pending = usePendingMissionChanges(missionId)
  const unsent = pendingCount(pending)
  const [summary, setSummary] = useState<MissionSummary | null>(null)
  const [selectedHabitat, setSelectedHabitat] = useState<HabitatCategory | null>(null)
  const [finishOpen, setFinishOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)

  // An active mission keeps the checklist it was started with, even if the
  // place watchlist changes later; the preview uses the current watchlist.
  const missionPlantIds = mission.data?.plants.map((plant) => plant.speciesId)
  const watchlist: WatchlistPlant[] = useMemo(() => {
    const items = associations.data?.items ?? []
    const byId = new Map(items.map((item) => [item.speciesId, item]))
    const ids = missionPlantIds ?? items.map((item) => item.speciesId)
    return ids.map((speciesId) => {
      const item = byId.get(speciesId)
      const record = item ? null : findApprovedSpecies({ speciesId })
      return {
        speciesId,
        name: item?.commonNames[0] ?? item?.scientificName ?? record?.common_names[0] ?? record?.scientific_name ?? speciesId,
        scientificName: item?.scientificName ?? record?.scientific_name ?? '',
        image: approvedCatalogueAssetForSpecies(speciesId)?.url ?? item?.imageUrl ?? null,
        habitats: lookup.data?.get(speciesId) ?? [],
      }
    })
    // missionPlantIds is derived; join it so the memo tracks its contents.
  }, [associations.data, lookup.data, missionPlantIds?.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
  const watchlistIds = useMemo(() => watchlist.map((plant) => plant.speciesId), [watchlist])
  const view = useMemo(() => (mission.data ? withPending(mission.data, pending) : null), [mission.data, pending])
  // A saved filter for a plant that is no longer on the checklist (or has no
  // habitat profile) falls back to all plants rather than an orphaned map.
  const savedSelection = view?.selectedSpeciesId ?? null
  const selectedSpecies = savedSelection && watchlist.some((plant) => plant.speciesId === savedSelection && plant.habitats.length)
    ? savedSelection : null
  const filterIds = useMemo(() => (selectedSpecies ? [selectedSpecies] : watchlistIds), [selectedSpecies, watchlistIds])
  const habitats = useMemo(
    () => (lookup.data && entry ? compatibleHabitats(filterIds, lookup.data, entry.available_habitats) : new Set<HabitatCategory>()),
    [lookup.data, entry, filterIds],
  )
  const allCompatible = useMemo(
    () => (lookup.data && entry ? compatibleHabitats(watchlistIds, lookup.data, entry.available_habitats) : new Set<HabitatCategory>()),
    [lookup.data, entry, watchlistIds],
  )
  const shown: HabitatOverlay | null = useMemo(() => (overlay.data ? visibleFeatures(overlay.data, habitats) : null), [overlay.data, habitats])
  const legend = useMemo(() => (shown ? legendFor(shown) : []), [shown])

  const setMission = useCallback((value: GuidedMission) => cache.setQueryData(['guided-mission', placeId], value), [cache, placeId])
  const start = useMutation({
    mutationFn: () => guidedMissionsApi.start({ placeId, watchlistSpeciesIds: watchlistIds, datasetVersion: HABITAT_DATASET_VERSION }),
    onSuccess: (value) => { setSummary(null); setMission(value) },
  })
  // Filter and progress changes show at once. If the backend cannot be
  // reached they are kept on this device and sent when the connection
  // returns (see mission-offline.ts); a definite rejection is reported.
  const select = useMutation({
    mutationFn: async (speciesId: string | null) => {
      setSelectedHabitat(null)
      pendingMissionStore.queueSelected(missionId!, speciesId)
      if (!online) return
      const value = await guidedMissionsApi.selectSpecies(missionId!, speciesId)
      pendingMissionStore.dropSelected(missionId!)
      setMission(value)
    },
    onError: (error) => {
      if (isRetryable(error)) return
      pendingMissionStore.dropSelected(missionId!)
      void mission.refetch()
    },
  })
  const progress = useMutation({
    mutationFn: async (input: { speciesId: string; state: MissionPlantState; noTargetFound?: boolean }) => {
      const change = { state: input.state, noTargetFound: input.noTargetFound }
      pendingMissionStore.queuePlant(missionId!, input.speciesId, change)
      if (!online) return
      const value = await guidedMissionsApi.setPlant(missionId!, input.speciesId, change)
      pendingMissionStore.dropPlant(missionId!, input.speciesId)
      setMission(value)
    },
    onError: (error, input) => {
      if (isRetryable(error)) return
      pendingMissionStore.dropPlant(missionId!, input.speciesId)
      void mission.refetch()
    },
  })
  const syncing = useRef(false)
  const sync = useCallback(async () => {
    if (!missionId || syncing.current) return
    syncing.current = true
    try {
      const queued = pendingMissionStore.get(missionId)
      if (queued.selected) {
        try {
          setMission(await guidedMissionsApi.selectSpecies(missionId, queued.selected.value))
          pendingMissionStore.dropSelected(missionId)
        } catch (error) {
          if (isRetryable(error)) return
          pendingMissionStore.dropSelected(missionId)
        }
      }
      for (const [speciesId, change] of Object.entries(queued.plants)) {
        try {
          setMission(await guidedMissionsApi.setPlant(missionId, speciesId, change))
          pendingMissionStore.dropPlant(missionId, speciesId)
        } catch (error) {
          if (isRetryable(error)) return
          pendingMissionStore.dropPlant(missionId, speciesId)
        }
      }
    } finally {
      syncing.current = false
    }
  }, [missionId, setMission])
  useEffect(() => {
    if (online && unsent && !progress.isPending && !select.isPending) void sync()
  }, [online, unsent, sync, progress.isPending, select.isPending])
  const finish = useMutation({
    mutationFn: () => guidedMissionsApi.complete(mission.data!.missionId),
    onSuccess: (value) => {
      setFinishOpen(false)
      setSummary(value)
      if (missionContextStore.getSnapshot()?.placeId === placeId) missionContextStore.clear()
      cache.setQueryData(['guided-mission', placeId], null)
    },
  })

  const scan = () => {
    if (!missionId) return
    if (profileId) missionContextStore.set({ missionId, placeId, profileId })
    navigate('/scan', { state: { returnTo: missionPath(placeId) } })
  }

  // --- Loading and unavailable states -----------------------------------
  const backToPlace = <BackLink to={`/places/${placeId}`}>Back to place</BackLink>
  if (index.isLoading || lookup.isLoading || place.isLoading || associations.isLoading) return <MissionState text="Loading guided mission…" />
  if (index.isError || lookup.isError) return <MissionState error text="Habitat guidance could not be loaded." retry={() => { void index.refetch(); void lookup.refetch() }} back={backToPlace} />
  if (place.isError || associations.isError || !place.data || !associations.data) return <MissionState error text="This place could not be loaded." retry={() => { void place.refetch(); void associations.refetch() }} back={backToPlace} />
  const placeName = place.data.displayName
  if (!entry) {
    return (
      <section className="mission-page mission-page--narrow">
        {backToPlace}
        <div className="mission-empty">
          <Icon name="Map" size={26} />
          <h2>Guided habitat highlights are unavailable for {placeName}</h2>
          <p>There is no generated habitat overlay for this place yet. Its plant watchlist is still on the place page.</p>
          <Link className="mission-button" to={`/places/${placeId}`}>View the plant watchlist</Link>
        </div>
      </section>
    )
  }
  if (mission.isLoading) return <MissionState text="Loading guided mission…" />
  if (!watchlist.length && !summary) {
    return (
      <section className="mission-page mission-page--narrow">
        {backToPlace}
        <div className="mission-empty">
          <Icon name="Leaf" size={26} />
          <h2>No watchlist for {placeName} yet</h2>
          <p>A mission needs at least one watchlist plant, so there is nothing to search for here right now.</p>
          <Link className="mission-button" to="/catalogue">Browse the plant catalogue</Link>
        </div>
      </section>
    )
  }

  const bounds = bboxToBounds(entry.bbox)
  const reportsBySpecies = new Map<string, number>()
  view?.reports.forEach((report) => { if (report.speciesId) reportsBySpecies.set(report.speciesId, (reportsBySpecies.get(report.speciesId) ?? 0) + 1) })
  const noOverlap = allCompatible.size === 0
  const habitatPanel = selectedHabitat && lookup.data && (
    <HabitatDetails
      habitat={selectedHabitat}
      label={shown?.features.find((feature) => feature.properties.habitat === selectedHabitat)?.properties.habitat_label ?? selectedHabitat}
      plants={plantsForHabitat(selectedHabitat, watchlistIds, lookup.data).map((id) => watchlist.find((plant) => plant.speciesId === id)!)}
      placeId={placeId}
      onClose={() => setSelectedHabitat(null)}
    />
  )

  // --- Completed: summary ------------------------------------------------
  if (summary) return <MissionSummaryView summary={summary} placeName={placeName} placeId={placeId} watchlist={watchlist} onRestart={() => setSummary(null)} />

  if (mission.isLoading || overlay.isLoading) return <MissionState text="Loading habitat map…" />
  if (overlay.isError) return <MissionState error text="The habitat map for this place could not be loaded." retry={() => void overlay.refetch()} back={backToPlace} />
  if (mission.isError) return <MissionState error text="Your mission progress could not be loaded." retry={() => void mission.refetch()} back={backToPlace} />

  const active = view
  const counts = active ? {
    looked: active.plants.filter((plant) => plant.state === 'looked_for').length,
    unable: active.plants.filter((plant) => plant.state === 'unable_to_check').length,
    notChecked: active.plants.filter((plant) => plant.state === 'not_checked').length,
    // A plant with a submitted sighting is never also a no-find outcome.
    noFind: active.plants.filter((plant) => plant.state === 'looked_for' && plant.noTargetFound && !reportsBySpecies.has(plant.speciesId)).length,
  } : null
  // Offer only plants that have compatible habitat in this place, so picking
  // one never leaves the map empty.
  const guidedPlants = watchlist.filter((plant) => plant.habitats.length
    && lookup.data && entry && compatibleHabitats([plant.speciesId], lookup.data, entry.available_habitats).size > 0)

  return (
    <section className="mission-page">
      {backToPlace}
      <header className="mission-header">
        <div>
          {!active && <p className="mission-eyebrow">Mission preview</p>}
          <h2>{placeName}</h2>
          <p className="mission-muted">
            {entry.place_type[0].toUpperCase() + entry.place_type.slice(1)} · {watchlist.length} watchlist {watchlist.length === 1 ? 'plant' : 'plants'}
            {active && <> · started {formatDateTime(active.startedAt)}</>}
          </p>
        </div>
        {active && (
          <div className="mission-header__actions">
            <button type="button" className="mission-button mission-button--primary" onClick={scan}><Icon name="ScanLine" size={17} />Scan a plant</button>
            <button type="button" className="mission-button" onClick={() => setFinishOpen(true)}>Finish mission</button>
          </div>
        )}
      </header>

      <p className="mission-guidance-banner">
        <Icon name="Info" size={17} />
        <span><strong>Highlights show compatible habitat to search, not confirmed plant locations.</strong> They are not walking routes, access has not been verified, and local signs, closures and restrictions take priority.</span>
      </p>
      {active && (!online || unsent > 0) && (
        <p className="mission-sync" role="status">
          <Icon name={online ? 'RefreshCw' : 'WifiOff'} size={16} />
          <span>
            {online
              ? `${unsent} ${unsent === 1 ? 'change' : 'changes'} not yet saved to your account.`
              : 'You are offline. Progress is kept on this device and saved when you reconnect.'}
          </span>
          {online && <button type="button" className="mission-text-button" onClick={() => void sync()}>Try again</button>}
        </p>
      )}

      <div className="mission-layout">
        <div className="mission-layout__map">
          {noOverlap ? (
            <div className="mission-empty mission-empty--map">
              <h3>No compatible mapped habitat here</h3>
              <p>The habitats mapped in {placeName} do not match its watchlist plants, so nothing is highlighted. The plants can still grow elsewhere in the place.</p>
            </div>
          ) : (
            <>
              <div className="mission-map-shell">
                <GuidedMissionMap
                  overlay={shown ?? { type: 'FeatureCollection', features: [] }}
                  boundary={place.data.geometry}
                  bounds={bounds}
                  selected={selectedHabitat}
                  onSelect={setSelectedHabitat}
                  label={`Compatible habitat map for ${placeName}. ${legend.length} habitat categories shown. The list below describes the same habitats.`}
                />
                {habitatPanel}
              </div>
              <div className="mission-legend" aria-label="Map legend">
                <strong>Compatible habitat</strong>
                <ul>
                  {legend.map((item) => (
                    <li key={item.habitat}><span style={{ background: item.colour }} aria-hidden />{item.label}</li>
                  ))}
                </ul>
              </div>
            </>
          )}
          <button type="button" className="mission-about-toggle" aria-expanded={aboutOpen} onClick={() => setAboutOpen(!aboutOpen)}>
            <Icon name="BookOpen" size={15} />About this guidance and data sources
          </button>
          {aboutOpen && <AboutGuidance />}
        </div>

        <div className="mission-layout__panel">
          {!active ? (
            <section className="mission-card">
              <h3>Watchlist plants</h3>
              <p>The map highlights habitat types where these plants tend to grow. Use it to focus your search.</p>
              <ul className="mission-preview-plants">
                {watchlist.map((plant) => <PlantThumb key={plant.speciesId} plant={plant} placeId={placeId} />)}
              </ul>
              <button type="button" className="mission-button mission-button--primary mission-button--block" disabled={start.isPending || noOverlap} onClick={() => start.mutate()}>
                {start.isPending ? <PlantLoader compact label="Starting…" /> : 'Start guided mission'}
              </button>
              {start.error && <p className="mission-alert" role="alert">The mission could not be started. Check your connection and try again.</p>}
            </section>
          ) : (
            <>
              <section className="mission-card" aria-labelledby="filter-title">
                <h3 id="filter-title">Where to search</h3>
                {guidedPlants.length > 1 && (
                  <>
                    <div className="mission-filter" role="group" aria-label="Show habitat for one plant">
                      {guidedPlants.map((plant) => (
                        <button key={plant.speciesId} type="button" aria-pressed={selectedSpecies === plant.speciesId}
                          onClick={() => select.mutate(selectedSpecies === plant.speciesId ? null : plant.speciesId)}>
                          {plant.name}
                        </button>
                      ))}
                    </div>
                    {selectedSpecies && <button type="button" className="mission-text-button" onClick={() => select.mutate(null)}>Clear filter</button>}
                  </>
                )}
                <HabitatList
                  legend={legend}
                  watchlist={watchlist}
                  watchlistIds={filterIds}
                  lookup={lookup.data!}
                  onOpen={(habitat) => {
                    setSelectedHabitat(habitat)
                    // The details open over the map; bring it into view on phones.
                    requestAnimationFrame(() => document.querySelector('.mission-map-shell')?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
                  }}
                />
              </section>

              <section className="mission-card" aria-labelledby="progress-title">
                <h3 id="progress-title">Your visit</h3>
                <dl className="mission-counts">
                  <div><dt>Looked for</dt><dd>{counts!.looked}</dd></div>
                  <div><dt>Unable to check</dt><dd>{counts!.unable}</dd></div>
                  <div><dt>Not yet checked</dt><dd>{counts!.notChecked}</dd></div>
                </dl>
                <dl className="mission-counts mission-counts--evidence">
                  <div><dt>Sightings submitted</dt><dd>{active.reports.length}</dd></div>
                  <div><dt>Scans</dt><dd>{active.scansCount}</dd></div>
                  <div><dt>No target plant found</dt><dd>{counts!.noFind}</dd></div>
                </dl>
                <ul className="mission-plants">
                  {watchlist.map((plant) => {
                    const item = active.plants.find((candidate) => candidate.speciesId === plant.speciesId)
                    return (
                      <PlantProgress
                        key={plant.speciesId}
                        plant={plant}
                        placeId={placeId}
                        state={item?.state ?? 'not_checked'}
                        noTargetFound={item?.noTargetFound ?? false}
                        reports={reportsBySpecies.get(plant.speciesId) ?? 0}
                        busy={progress.isPending && progress.variables?.speciesId === plant.speciesId}
                        onChange={(state, noTargetFound) => progress.mutate({ speciesId: plant.speciesId, state, noTargetFound })}
                      />
                    )
                  })}
                </ul>
                {(progress.error || select.error) && !isRetryable(progress.error ?? select.error) && (
                  <p className="mission-alert" role="alert">That change could not be saved. Try again.</p>
                )}
              </section>

              <section className="mission-card" aria-labelledby="reports-title">
                <h3 id="reports-title">Sightings from this mission</h3>
                {active.reports.length ? (
                  <ul className="mission-reports">
                    {active.reports.map((report) => (
                      <li key={report.reportId}>
                        <Link to={`/reports/${report.reportId}`}>
                          <strong>{watchlist.find((plant) => plant.speciesId === report.speciesId)?.name ?? 'Plant report'}</strong>
                          <span>{formatDateTime(report.submittedAt)} · community report</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : <p className="mission-muted">None yet. Scan a plant with the camera or a gallery photo, then submit a sighting.</p>}
                <button type="button" className="mission-button mission-button--primary mission-button--block" onClick={scan}><Icon name="ScanLine" size={17} />Scan a plant</button>
              </section>
            </>
          )}
        </div>
      </div>

      {finishOpen && active && counts && (
        <FinishDialog
          counts={counts}
          reports={active.reports.length}
          unsent={unsent}
          pending={finish.isPending}
          failed={Boolean(finish.error)}
          onClose={() => { finish.reset(); setFinishOpen(false) }}
          onConfirm={() => finish.mutate()}
        />
      )}
    </section>
  )
}

// --- Pieces ----------------------------------------------------------------

function MissionState({ text, error = false, retry, back }: { text: string; error?: boolean; retry?: () => void; back?: React.ReactNode }) {
  return (
    <section className="mission-page mission-page--narrow">
      {back}
      <div className="mission-empty" role={error ? 'alert' : 'status'}>
        {!error && /^(Loading|Opening)/.test(text) ? <PlantLoader label={text} /> : <p>{text}</p>}
        {retry && <button type="button" className="mission-button" onClick={retry}>Try again</button>}
      </div>
    </section>
  )
}

const catalogueLink = (speciesId: string, placeId: string) => `/catalogue/${speciesId}?from=mission&place=${encodeURIComponent(placeId)}`

function PlantThumb({ plant, placeId }: { plant: WatchlistPlant; placeId: string }) {
  return (
    <li>
      <Link to={catalogueLink(plant.speciesId, placeId)} className="mission-plant-thumb">
        {plant.image ? <img src={referenceImageSrc(plant.image)} alt={`Reference view of ${plant.scientificName}`} loading="lazy" /> : <span className="mission-plant-thumb__placeholder"><Icon name="Leaf" size={20} /></span>}
        <span>
          <strong>{plant.name}</strong>
          <i>{plant.scientificName}</i>
          <small>{plant.habitats.length ? `${plant.habitats.length} habitat ${plant.habitats.length === 1 ? 'type' : 'types'}` : 'Habitat guidance unavailable'}</small>
        </span>
      </Link>
    </li>
  )
}

function HabitatList({ legend, watchlist, watchlistIds, onOpen, lookup }: {
  legend: ReturnType<typeof legendFor>
  watchlist: WatchlistPlant[]
  watchlistIds: string[]
  onOpen: (habitat: HabitatCategory) => void
  lookup: Map<string, HabitatCategory[]>
}) {
  if (!legend.length) return <p className="mission-muted">No compatible habitat for this plant in this place.</p>
  return (
    <ul className="mission-habitat-list" aria-label="Habitats on the map">
      {legend.map((item) => (
        <li key={item.habitat}>
          <button type="button" onClick={() => onOpen(item.habitat)}>
            <span className="mission-swatch" style={{ background: item.colour }} aria-hidden />
            <span>
              <strong>{item.label}</strong>
              <small>{plantsForHabitat(item.habitat, watchlistIds, lookup).map((id) => watchlist.find((plant) => plant.speciesId === id)?.name ?? id).join(', ')}</small>
            </span>
            <Icon name="ChevronRight" size={16} />
          </button>
        </li>
      ))}
    </ul>
  )
}

function HabitatDetails({ habitat, label, plants, placeId, onClose }: {
  habitat: HabitatCategory
  label: string
  plants: WatchlistPlant[]
  placeId: string
  onClose: () => void
}) {
  return (
    <section className="mission-habitat-sheet" aria-labelledby="habitat-sheet-title" role="region">
      <header>
        <span className="mission-swatch" style={{ background: HABITAT_COLOURS[habitat] }} aria-hidden />
        <div>
          <p className="mission-eyebrow">Compatible habitat</p>
          <h3 id="habitat-sheet-title">{label}</h3>
        </div>
        <button type="button" className="mission-icon-button" onClick={onClose} aria-label="Close habitat details"><Icon name="X" size={18} /></button>
      </header>
      <p className="mission-habitat-sheet__notice">{SEARCH_GUIDANCE}</p>
      <p className="mission-muted">Matching watchlist plants:</p>
      <ul className="mission-habitat-sheet__plants">
        {plants.map((plant) => (
          <li key={plant.speciesId}><Link to={catalogueLink(plant.speciesId, placeId)}>{plant.name}<i>{plant.scientificName}</i></Link></li>
        ))}
      </ul>
    </section>
  )
}

function PlantProgress({ plant, placeId, state, noTargetFound, reports, busy, onChange }: {
  plant: WatchlistPlant
  placeId: string
  state: MissionPlantState
  noTargetFound: boolean
  reports: number
  busy: boolean
  onChange: (state: MissionPlantState, noTargetFound?: boolean) => void
}) {
  return (
    <li className={`mission-plant mission-plant--${state}`}>
      <div className="mission-plant__head">
        {plant.image ? <img src={referenceImageSrc(plant.image)} alt="" loading="lazy" /> : <span className="mission-plant-thumb__placeholder"><Icon name="Leaf" size={18} /></span>}
        <div>
          <strong>{plant.name}</strong>
          <span className="mission-plant__state">{STATE_LABELS[state]}{reports > 0 && ` · ${reports} ${reports === 1 ? 'sighting' : 'sightings'} submitted`}</span>
        </div>
        <Link to={catalogueLink(plant.speciesId, placeId)} className="mission-text-button">Reference</Link>
      </div>
      <div className="mission-segmented" role="radiogroup" aria-label={`Progress for ${plant.name}`}>
        {(Object.keys(STATE_LABELS) as MissionPlantState[]).map((value) => (
          <button key={value} type="button" role="radio" aria-checked={state === value} disabled={busy} onClick={() => { if (state !== value) onChange(value) }}>
            {STATE_LABELS[value]}
          </button>
        ))}
      </div>
      {state === 'looked_for' && reports === 0 && (
        noTargetFound ? (
          <p className="mission-nofind" role="status">
            <Icon name="CircleCheck" size={15} />
            <span>Recorded: no target plant found on this visit. This does not confirm the plant is absent from the place.
              {' '}<button type="button" className="mission-text-button" disabled={busy} onClick={() => onChange('looked_for', false)}>Undo</button></span>
          </p>
        ) : (
          <button type="button" className="mission-button mission-button--small" disabled={busy} onClick={() => onChange('looked_for', true)}>No target plant found</button>
        )
      )}
      {!plant.habitats.length && <p className="mission-muted">Habitat guidance unavailable for this plant.</p>}
    </li>
  )
}

function FinishDialog({ counts, reports, unsent, pending, failed, onClose, onConfirm }: {
  counts: { looked: number; unable: number; notChecked: number; noFind: number }
  reports: number
  unsent: number
  pending: boolean
  failed: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useDialogA11y(ref, onClose)
  return createPortal(
    <div className="mission-sheet">
      <div className="mission-sheet__scrim" onClick={onClose} />
      <div ref={ref} className="mission-sheet__panel" role="dialog" aria-modal="true" aria-labelledby="finish-title" tabIndex={-1}>
        <h2 id="finish-title">Finish this mission?</h2>
        <p>{counts.looked} looked for · {counts.unable} unable to check · {counts.notChecked} not checked · {reports} {reports === 1 ? 'sighting' : 'sightings'} submitted.</p>
        {unsent > 0
          ? <p className="mission-alert" role="status">Some progress is not saved to your account yet. Reconnect before finishing.</p>
          : <p className="mission-muted">If you leave without finishing, your progress is saved and you can resume it later.</p>}
        {failed && <p className="mission-alert" role="alert">The mission could not be finished. Try again.</p>}
        <footer>
          <button type="button" data-dialog-initial className="mission-button" onClick={onClose}>Keep going</button>
          <button type="button" className="mission-button mission-button--primary" disabled={pending || unsent > 0} onClick={onConfirm}>{pending ? <PlantLoader compact label="Finishing…" /> : 'Finish mission'}</button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}

function MissionSummaryView({ summary, placeName, placeId, watchlist, onRestart }: {
  summary: MissionSummary
  placeName: string
  placeId: string
  watchlist: WatchlistPlant[]
  onRestart: () => void
}) {
  return (
    <section className="mission-page mission-page--narrow">
      <BackLink to={`/places/${placeId}`}>Back to place</BackLink>
      <header className="mission-header">
        <div>
          <p className="mission-eyebrow">Mission finished</p>
          <h2>{placeName}</h2>
          <p className="mission-muted">{formatDateTime(summary.startedAt)}{summary.completedAt && ` – ${formatDateTime(summary.completedAt)}`}</p>
        </div>
      </header>
      <section className="mission-card">
        <h3>Plants on the watchlist</h3>
        <dl className="mission-counts">
          <div><dt>Looked for</dt><dd>{summary.lookedForCount}</dd></div>
          <div><dt>Unable to check</dt><dd>{summary.unableToCheckCount}</dd></div>
          <div><dt>Not checked</dt><dd>{summary.notCheckedCount}</dd></div>
        </dl>
        <h3>What you contributed</h3>
        <dl className="mission-counts mission-counts--evidence">
          <div><dt>Scans</dt><dd>{summary.scansCount}</dd></div>
          <div><dt>Sightings submitted</dt><dd>{summary.reportsSubmittedCount}</dd></div>
          <div><dt>No target plant found</dt><dd>{summary.noTargetFoundCount}</dd></div>
        </dl>
        {summary.reportsSubmittedCount === 0 ? (
          <p className="mission-summary-note">No target plants reported during this mission. This describes this visit only, not whether the plants are present in the place.</p>
        ) : (
          <ul className="mission-reports">
            {summary.reports.map((report) => (
              <li key={report.reportId}>
                <Link to={`/reports/${report.reportId}`}>
                  <strong>{watchlist.find((plant) => plant.speciesId === report.speciesId)?.name ?? 'Plant report'}</strong>
                  <span>{formatDateTime(report.submittedAt)} · community report</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {summary.noTargetFoundCount > 0 && <p className="mission-muted">A “No target plant found” outcome does not confirm the plant is absent from the place.</p>}
      </section>
      <div className="mission-summary-actions">
        <Link className="mission-button mission-button--primary" to={`/places/${placeId}`}>Back to {placeName}</Link>
        <button type="button" className="mission-button" onClick={onRestart}>Plan another visit</button>
      </div>
    </section>
  )
}

function AboutGuidance() {
  const release = useHabitatRelease(true)
  return (
    <section className="mission-about">
      <p>Highlights come from mapped land cover and water data, matched to the habitat types each plant is known to use. They describe compatibility only, not sightings.</p>
      {release.data && (
        <>
          <ul>{release.data.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
          <p className="mission-muted">
            Data version {HABITAT_DATASET_VERSION}. Sources: OpenStreetMap contributors via Geofabrik (ODbL), {release.data.environmental_sources.join(', ')}.
          </p>
        </>
      )}
    </section>
  )
}

const formatDateTime = (value: string) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(ENGLISH_LOCALE, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
}
