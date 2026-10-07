import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { approvedCatalogueAssetForSpecies } from '@shared/catalogue'
import { BackLink } from '@/components/BackLink'
import { Icon } from '@/components/Icon'
import { useDialogA11y } from '@/hooks/useDialogA11y'
import { usePrivateAccess } from '@/features/private-access/private-access-store'
import { api, ApiError } from '@/services/api-client'
import { guidedMissionsApi, type GuidedMission, type MissionPlantState, type MissionSummary } from '@/services/api/guided-missions'
import type { PlaceDetail, PlacePlantAssociationsResponse } from '@/types'
import { ENGLISH_LOCALE } from '@/utils/date-time'
import { GuidedMissionMap } from './GuidedMissionMap'
import {
  HABITAT_COLOURS, HABITAT_DATASET_VERSION, bboxToBounds, compatibleHabitats, legendFor, plantsForHabitat,
  useHabitatIndex, useHabitatLookup, useHabitatOverlay, useHabitatRelease, visibleFeatures,
  type HabitatCategory, type HabitatOverlay,
} from './habitat-data'
import { missionContextStore, missionPath } from './mission-context'
import './guided-missions.css'

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
  const entry = index.data?.byId.get(placeId) ?? null
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
  })
  const [summary, setSummary] = useState<MissionSummary | null>(null)
  const [selectedHabitat, setSelectedHabitat] = useState<HabitatCategory | null>(null)
  const [finishOpen, setFinishOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)

  const watchlist: WatchlistPlant[] = useMemo(() => (associations.data?.items ?? []).map((item) => ({
    speciesId: item.speciesId,
    name: item.commonNames[0] ?? item.scientificName,
    scientificName: item.scientificName,
    image: approvedCatalogueAssetForSpecies(item.speciesId)?.url ?? item.imageUrl ?? null,
    habitats: lookup.data?.get(item.speciesId) ?? [],
  })), [associations.data, lookup.data])
  const watchlistIds = useMemo(() => watchlist.map((plant) => plant.speciesId), [watchlist])
  const selectedSpecies = mission.data?.selectedSpeciesId ?? null
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

  const setMission = (value: GuidedMission) => cache.setQueryData(['guided-mission', placeId], value)
  const start = useMutation({
    mutationFn: () => guidedMissionsApi.start({ placeId, watchlistSpeciesIds: watchlistIds, datasetVersion: HABITAT_DATASET_VERSION }),
    onSuccess: (value) => { setSummary(null); setMission(value) },
  })
  const select = useMutation({
    mutationFn: (speciesId: string | null) => guidedMissionsApi.selectSpecies(mission.data!.missionId, speciesId),
    onMutate: (speciesId) => { if (mission.data) setMission({ ...mission.data, selectedSpeciesId: speciesId }); setSelectedHabitat(null) },
    onSuccess: setMission,
  })
  const progress = useMutation({
    mutationFn: (input: { speciesId: string; state: MissionPlantState; noTargetFound?: boolean }) =>
      guidedMissionsApi.setPlant(mission.data!.missionId, input.speciesId, { state: input.state, noTargetFound: input.noTargetFound }),
    onSuccess: setMission,
  })
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
    if (!mission.data || !profileId) return
    missionContextStore.set({ missionId: mission.data.missionId, placeId, profileId })
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
  if (!watchlist.length) {
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
  mission.data?.reports.forEach((report) => { if (report.speciesId) reportsBySpecies.set(report.speciesId, (reportsBySpecies.get(report.speciesId) ?? 0) + 1) })
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

  const active = mission.data ?? null
  const counts = active ? {
    looked: active.plants.filter((plant) => plant.state === 'looked_for').length,
    unable: active.plants.filter((plant) => plant.state === 'unable_to_check').length,
    notChecked: active.plants.filter((plant) => plant.state === 'not_checked').length,
    noFind: active.plants.filter((plant) => plant.state === 'looked_for' && plant.noTargetFound).length,
  } : null

  return (
    <section className="mission-page">
      {backToPlace}
      <header className="mission-header">
        <div>
          <p className="mission-eyebrow"><Icon name="Route" size={15} />{active ? 'Guided mission in progress' : 'Guided mission preview'}</p>
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
        <span><strong>Compatible habitat is search guidance, not a confirmed plant location.</strong> Highlights are not walking routes and access has not been verified. Local signs, closures and restrictions take priority.</span>
      </p>

      <div className="mission-layout">
        <div className="mission-layout__map">
          {noOverlap ? (
            <div className="mission-empty mission-empty--map">
              <h3>No compatible mapped habitat here</h3>
              <p>The habitats mapped in {placeName} do not match the habitat profiles of its watchlist plants, so nothing is highlighted. Plants can still grow outside these categories.</p>
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
              <h3>Before you start</h3>
              <p>This mission highlights the mapped habitat types where the plants on this place’s watchlist tend to grow — water edges, open grassland, forest edges and so on. Use them to focus your search. A highlight does not mean a plant is there.</p>
              <ul className="mission-preview-plants">
                {watchlist.map((plant) => <PlantThumb key={plant.speciesId} plant={plant} placeId={placeId} />)}
              </ul>
              <button type="button" className="mission-button mission-button--primary mission-button--block" disabled={start.isPending || noOverlap} onClick={() => start.mutate()}>
                {start.isPending ? 'Starting…' : 'Start guided mission'}
              </button>
              {start.error && <p className="mission-alert" role="alert">The mission could not be started. Check your connection and try again.</p>}
            </section>
          ) : (
            <>
              <section className="mission-card" aria-labelledby="filter-title">
                <h3 id="filter-title">Show habitat for</h3>
                <div className="mission-filter" role="group" aria-label="Filter habitat by plant">
                  <button type="button" aria-pressed={!selectedSpecies} onClick={() => select.mutate(null)}>All plants</button>
                  {watchlist.map((plant) => (
                    <button key={plant.speciesId} type="button" aria-pressed={selectedSpecies === plant.speciesId} disabled={!plant.habitats.length}
                      onClick={() => select.mutate(plant.speciesId)} title={plant.habitats.length ? undefined : 'Habitat guidance unavailable for this plant'}>
                      {plant.name}
                    </button>
                  ))}
                </div>
                {selectedSpecies && <button type="button" className="mission-text-button" onClick={() => select.mutate(null)}>Clear filter</button>}
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
                {progress.error && <p className="mission-alert" role="alert">That change could not be saved. Try again.</p>}
              </section>

              <section className="mission-card" aria-labelledby="reports-title">
                <h3 id="reports-title">Sightings from this mission</h3>
                {active.reports.length ? (
                  <ul className="mission-reports">
                    {active.reports.map((report) => (
                      <li key={report.reportId}>
                        <Link to={`/reports/${report.reportId}`}>
                          <strong>{watchlist.find((plant) => plant.speciesId === report.speciesId)?.name ?? 'Plant report'}</strong>
                          <span>{formatDateTime(report.submittedAt)} · community report, not expert-verified</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : <p className="mission-muted">None yet. Scan a plant to identify it and submit a sighting — you will come back here afterwards.</p>}
                <button type="button" className="mission-button mission-button--primary mission-button--block" onClick={scan}><Icon name="ScanLine" size={17} />Scan a plant</button>
                <p className="mission-muted">Use the camera or a photo from your gallery. A scan result is a prediction until you complete the normal report steps.</p>
              </section>
            </>
          )}
        </div>
      </div>

      {finishOpen && active && counts && (
        <FinishDialog
          counts={counts}
          reports={active.reports.length}
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
        {!error && <span className="mission-spinner" aria-hidden />}
        <p>{text}</p>
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
        {plant.image ? <img src={plant.image} alt={`Reference view of ${plant.scientificName}`} loading="lazy" /> : <span className="mission-plant-thumb__placeholder"><Icon name="Leaf" size={20} /></span>}
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
      <p className="mission-muted">Watchlist plants whose habitat profile includes this habitat:</p>
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
        {plant.image ? <img src={plant.image} alt="" loading="lazy" /> : <span className="mission-plant-thumb__placeholder"><Icon name="Leaf" size={18} /></span>}
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
      {!plant.habitats.length && <p className="mission-muted">Habitat guidance is unavailable for this plant, so it is not used in the map filter.</p>}
    </li>
  )
}

function FinishDialog({ counts, reports, pending, failed, onClose, onConfirm }: {
  counts: { looked: number; unable: number; notChecked: number; noFind: number }
  reports: number
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
        <p className="mission-muted">If you leave without finishing, your progress is saved and you can resume it later.</p>
        {failed && <p className="mission-alert" role="alert">The mission could not be finished. Try again.</p>}
        <footer>
          <button type="button" data-dialog-initial className="mission-button" onClick={onClose}>Keep going</button>
          <button type="button" className="mission-button mission-button--primary" disabled={pending} onClick={onConfirm}>{pending ? 'Finishing…' : 'Finish mission'}</button>
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
          <p className="mission-eyebrow"><Icon name="CircleCheck" size={15} />Mission finished</p>
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
          <p className="mission-summary-note">No target plants reported during this mission. This only describes this visit — not finding a plant does not show it is absent.</p>
        ) : (
          <ul className="mission-reports">
            {summary.reports.map((report) => (
              <li key={report.reportId}>
                <Link to={`/reports/${report.reportId}`}>
                  <strong>{watchlist.find((plant) => plant.speciesId === report.speciesId)?.name ?? 'Plant report'}</strong>
                  <span>{formatDateTime(report.submittedAt)} · community report, not expert-verified</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {summary.noTargetFoundCount > 0 && <p className="mission-muted">“No target plant found” records what you looked for on this visit. It does not confirm a plant is absent.</p>}
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
      <p>Habitat highlights come from mapped land cover and water data matched to each plant’s known habitat types. They are not predictions, scores or sightings.</p>
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
