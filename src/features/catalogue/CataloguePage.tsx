import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { useOnline } from '@/hooks/useOnline'
import {
  approvedCatalogueAssetForSpecies,
  approvedSpeciesDataset,
  type ApprovedSpeciesDataset,
} from '@shared/catalogue'
import {
  cataloguePackSize,
  downloadCataloguePack,
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
  const normalized = query.trim().toLocaleLowerCase()
  const updateAvailable = Boolean(
    installed && installed.version !== approvedSpeciesDataset.catalogue_version,
  )
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

  const download = async () => {
    setPackState('working')
    try {
      const nextInstalled = await downloadCataloguePack()
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
          <span>{formatPackSize(cataloguePackSize())} · reviewed {formatDate(dataset.reviewed_at)}</span>
          {installed ? (
            <div>
              <span>Installed v{installed.version}</span>
              {updateAvailable && <span>A newer catalogue version is available.</span>}
              <button type="button" onClick={() => void remove()} disabled={packState === 'working'}>
                Remove offline catalogue
              </button>
              <button type="button" onClick={() => void download()} disabled={packState === 'working'}>
                Download again
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
