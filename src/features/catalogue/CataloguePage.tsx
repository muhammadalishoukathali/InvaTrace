// The plant catalogue list at /catalogue. This is the one screen that has to
// keep working with no signal at all, because the whole point of it is that a
// volunteer out on a trail can still look up what a plant is. The species data
// and one reference photo each are bundled into the app, and on top of that the
// user can download an "offline pack" with the full-size images - that part
// lives in offline-catalogue.ts.
//
// So there are two sources for the same species here: the bundled dataset from
// @shared/catalogue, and whatever the installed pack has. The page prefers the
// pack when one is installed and falls back to the bundle otherwise, which is
// why the image URLs are kept in state rather than computed inline.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { useOnline } from '@/hooks/useOnline'
import {
  approvedCatalogueAssetForSpecies,
  catalogueManifest,
  approvedSpeciesDataset,
  type CatalogueManifest,
  type ApprovedSpeciesDataset,
} from '@shared/catalogue'
import {
  cataloguePackSize,
  downloadCataloguePack,
  fetchLatestCatalogueManifest,
  formatPackSize,
  installedCataloguePack,
  loadInstalledCatalogueData,
  removeCataloguePack,
  type InstalledCataloguePack,
} from './offline-catalogue'
import './catalogue.css'

const bundledApprovedImages = Object.fromEntries(
  approvedSpeciesDataset.records.flatMap((record) => {
    const asset = approvedCatalogueAssetForSpecies(record.species_id)
    return asset ? [[record.species_id, asset.url]] : []
  }),
)

export function CataloguePage() {
  const online = useOnline()
  const [query, setQuery] = useState('')
  const [installed, setInstalled] = useState<InstalledCataloguePack | null>(() => installedCataloguePack())
  const [dataset, setDataset] = useState<ApprovedSpeciesDataset>(approvedSpeciesDataset)
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({})
  const [approvedImages, setApprovedImages] = useState<Record<string, string>>(bundledApprovedImages)
  const releasePack = useRef<(() => void) | null>(null)
  const [packState, setPackState] = useState<'idle' | 'working' | 'error'>('idle')
  const [serverManifest, setServerManifest] = useState<CatalogueManifest | null>(null)
  const normalized = query.trim().toLocaleLowerCase()
  const availableManifest = serverManifest ?? catalogueManifest
  const latestVersion = availableManifest.catalogue_version
  const updateAvailable = Boolean(installed && isNewerVersion(latestVersion, installed.version))
  const records = useMemo(() => dataset.records.filter((record) => (
    !normalized
    || record.scientific_name.toLocaleLowerCase().includes(normalized)
    || record.common_names.some((name) => name.toLocaleLowerCase().includes(normalized))
  )), [dataset.records, normalized])

  useEffect(() => {
    let active = true
    void loadInstalledCatalogueData().then((pack) => {
      if (!active || !pack) return
      setDataset(pack.approved)
      setAssetUrls(pack.assetUrls)
      setApprovedImages(Object.fromEntries(
        Object.values(pack.approvedImages).map((asset) => [asset.species_id, asset.url]),
      ))
      releasePack.current?.()
      releasePack.current = pack.release
    })
    return () => {
      active = false
      releasePack.current?.()
    }
  }, [])

  useEffect(() => {
    if (!online) return
    let active = true
    setInstalled(installedCataloguePack())
    void fetchLatestCatalogueManifest()
      .then((manifest) => {
        if (active) setServerManifest(manifest)
      })
      .catch(() => {
        // The bundled manifest remains the safe fallback. A failed update
        // check must never invalidate the last verified installed pack.
      })
    return () => { active = false }
  }, [online])

  const download = async () => {
    setPackState('working')
    try {
      const nextInstalled = await downloadCataloguePack(availableManifest)
      setInstalled(nextInstalled)
      const pack = await loadInstalledCatalogueData()
      if (pack) {
        setDataset(pack.approved)
        releasePack.current?.()
        releasePack.current = pack.release
        setAssetUrls(pack.assetUrls)
        setApprovedImages(Object.fromEntries(
          Object.values(pack.approvedImages).map((asset) => [asset.species_id, asset.url]),
        ))
      }
      setPackState('idle')
    } catch {
      setPackState('error')
    }
  }

  const remove = async () => {
    setPackState('working')
    await removeCataloguePack()
    setInstalled(null)
    setDataset(approvedSpeciesDataset)
    releasePack.current?.()
    releasePack.current = null
    setAssetUrls({})
    setApprovedImages(bundledApprovedImages)
    setPackState('idle')
  }

  return (
    <section className="catalogue-page">
      <div className="catalogue-page__intro">
        <div>
          <h2>Invasive plants recorded in Malaysia</h2>
          <p>
            Evidence-reviewed catalogue of {dataset.record_count} plants.
            Inclusion does not grant permission to remove a plant.
          </p>
          <Link to="/places" className="catalogue-page__places-link">Browse parks, forests and trails</Link>
        </div>
        <div className="catalogue-pack" aria-live="polite">
          <strong>Offline catalogue · v{dataset.catalogue_version}</strong>
          <span>
            {formatPackSize(cataloguePackSize(availableManifest))}
            {' '}· reviewed {formatDate(availableManifest.last_reviewed)}
          </span>
          {installed ? (
            <div>
              <span>Installed v{installed.version}</span>
              {updateAvailable && (
                <span>
                  A newer catalogue version ({latestVersion}) is available.
                  {latestVersion !== approvedSpeciesDataset.catalogue_version
                    ? ' Refresh the app before downloading it.'
                    : ''}
                </span>
              )}
              <button type="button" onClick={() => void remove()} disabled={packState === 'working'}>
                Remove offline catalogue
              </button>
              <button type="button" onClick={() => void download()} disabled={packState === 'working'}>
                {updateAvailable ? 'Update offline catalogue' : 'Download again'}
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => void download()} disabled={packState === 'working'}>
              {packState === 'working' ? 'Checking and saving…' : 'Download offline catalogue'}
            </button>
          )}
          {packState === 'error' && (
            <span role="alert">Download failed. Any previously installed version was kept.</span>
          )}
        </div>
      </div>

      {!online && (
        <div className="catalogue-offline-notice" role="status">
          <strong>Offline catalogue</strong>
          <span>
            {installed ? `Installed v${installed.version}` : 'Bundled catalogue'}
            {' '}· last reviewed {formatDate(installed?.reviewedAt ?? dataset.reviewed_at)}.
            {' '}Map and current place data need a connection.
          </span>
        </div>
      )}

      <label className="catalogue-search">
        <span className="sr-only">Search catalogue</span>
        <Icon name="Search" size={18} color="var(--muted)" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search scientific or common name"
        />
        {query && <button type="button" onClick={() => setQuery('')}>Clear</button>}
      </label>

      {records.length === 0 ? (
        <div className="catalogue-empty" role="status">
          <strong>No supported plants found</strong>
          <button type="button" onClick={() => setQuery('')}>Clear search</button>
        </div>
      ) : (
        <ol className="catalogue-list" aria-label={`${records.length} catalogue plants`}>
          {records.map((record) => {
            const imageUrl = approvedImages[record.species_id]
            return (
              <li key={record.species_id}>
                <Link to={`/catalogue/${record.species_id}`}>
                  <span className="catalogue-list__image">
                    {imageUrl ? (
                      <img src={assetUrls[imageUrl] ?? imageUrl} alt="" loading="lazy" />
                    ) : <Icon name="Leaf" size={24} color="var(--green)" />}
                  </span>
                  <span className="catalogue-list__names">
                    <strong>{record.scientific_name}</strong>
                    <span>{record.common_names.join(' · ')}</span>
                  </span>
                  <span className="catalogue-list__status">Present in Malaysia</span>
                  <Icon name="ChevronRight" size={18} color="var(--icon)" />
                </Link>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

const formatDate = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })
  .format(new Date(`${value}T00:00:00Z`))

function isNewerVersion(candidate: string, current: string): boolean {
  const next = candidate.split('.').map(Number)
  const installed = current.split('.').map(Number)
  for (let index = 0; index < Math.max(next.length, installed.length); index += 1) {
    const difference = (next[index] ?? 0) - (installed[index] ?? 0)
    if (difference !== 0) return difference > 0
  }
  return false
}
