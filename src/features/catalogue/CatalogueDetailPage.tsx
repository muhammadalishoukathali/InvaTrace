// One species page, reached from CataloguePage. Shows the full description,
// the status in Malaysia, and the safety/removal guidance.
//
// Same bundled-vs-offline-pack split as the list page: it starts with the data
// compiled into the app so something renders immediately, then swaps in the
// installed pack's copy if there is one. The pack's images come out of the Cache
// API as blob URLs, so releasePack() has to run on unmount or those URLs leak.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { BackLink } from '@/components/BackLink'
import { useOnline } from '@/hooks/useOnline'
import {
  approvedCatalogueAssetForSpecies,
  type ApprovedCatalogueAsset,
  approvedSpeciesDataset,
  catalogueDetailsDataset,
  type ApprovedSpeciesDataset,
  type CatalogueDetailsDataset,
  type CatalogueSource,
} from '@shared/catalogue'
import {
  cataloguePackRevision,
  installedCataloguePack,
  loadInstalledCatalogueData,
  packAssetUrl,
} from './offline-catalogue'
import './catalogue.css'
import { referenceImageSrc } from '@/data/reference-image-src'

export function CatalogueDetailPage() {
  const { speciesId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const online = useOnline()
  // Epic 7 (AC 7.4.1): opened from a guided mission, Back returns to the
  // mission. Carried in the URL so it survives a refresh.
  const missionPlace = searchParams.get('from') === 'mission' ? searchParams.get('place') : null
  const back = missionPlace && /^[a-zA-Z0-9-]+$/.test(missionPlace)
    ? { to: `/places/${missionPlace}/mission`, label: 'Back to mission' }
    : { to: '/catalogue', label: 'Back to catalogue' }
  const [dataset, setDataset] = useState<ApprovedSpeciesDataset>(approvedSpeciesDataset)
  const [details, setDetails] = useState<CatalogueDetailsDataset>(catalogueDetailsDataset)
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({})
  const [approvedImages, setApprovedImages] = useState<Record<string, ApprovedCatalogueAsset>>(
    () => Object.fromEntries(approvedSpeciesDataset.records.flatMap((item) => {
      const asset = approvedCatalogueAssetForSpecies(item.species_id)
      return asset ? [[asset.species_id, asset]] : []
    })),
  )
  const releasePack = useRef<(() => void) | null>(null)
  // Photos replaced since the pack was installed: online, show this build's
  // copy instead of the pack's old one (see cataloguePackRevision).
  const staleAssetUrls = useMemo(
    () => new Set(cataloguePackRevision(installedCataloguePack()).staleAssetUrls),
    [],
  )
  useEffect(() => {
    let active = true
    void loadInstalledCatalogueData().then((pack) => {
      if (!active || !pack) return
      setDataset(pack.approved)
      setDetails(pack.details)
      setAssetUrls(pack.assetUrls)
      setApprovedImages(Object.fromEntries(
        Object.values(pack.approvedImages).map((asset) => [asset.species_id, asset]),
      ))
      releasePack.current?.()
      releasePack.current = pack.release
    })
    return () => {
      active = false
      releasePack.current?.()
    }
  }, [])
  const normalizedSpeciesId = speciesId.trim().toLowerCase().replaceAll('_', '-')
  const record = dataset.records.find((item) => item.species_id === normalizedSpeciesId)
  if (!record) {
    return (
      <section className="catalogue-detail catalogue-empty" role="alert">
        <strong>Catalogue plant not found.</strong>
        <BackLink to="/catalogue">Back to catalogue</BackLink>
      </section>
    )
  }
  const detail = details.records.find((item) => item.species_id === record.species_id)
  if (!detail) {
    return (
      <section className="catalogue-detail catalogue-empty" role="alert">
        <strong>Reviewed catalogue detail is unavailable.</strong>
        <BackLink to="/catalogue">Back to catalogue</BackLink>
      </section>
    )
  }
  const sources = new Map<CatalogueSource['source_id'], CatalogueSource>([
    ...dataset.sources.map((source) => [source.source_id, source] as const),
    ...details.sources.map((source) => [source.source_id, source] as const),
  ])
  const detailSourceIds = Object.values(detail.source_ids).flat()
  const cited = [...new Set([...record.evidence_source_ids, ...detailSourceIds])]
    .map((sourceId) => sources.get(sourceId))
    .filter((source): source is CatalogueSource => Boolean(source))
  const image = approvedImages[record.species_id]

  return (
    <article className="catalogue-detail">
      {!online && (
        <div className="catalogue-offline-notice" role="status">
          <strong>Offline catalogue · v{dataset.catalogue_version}</strong>
          <span>Last reviewed {dataset.reviewed_at}. Current map and place data need a connection.</span>
        </div>
      )}
      <BackLink to={back.to}>{back.label}</BackLink>
      <header className="catalogue-detail__header">
        <div className="catalogue-detail__media">
          {image ? (
            <img src={packAssetUrl(assetUrls, image.url, staleAssetUrls, online) ?? referenceImageSrc(image.url)} alt={`Reference view of ${record.scientific_name}`} />
          ) : <Icon name="Leaf" size={38} color="var(--green)" />}
        </div>
        <div>
          <h2>{record.scientific_name}</h2>
          <p>{record.common_names.join(' · ')}</p>
          {record.accepted_scientific_name && (
            <p>Accepted name used by the reviewed source: <i>{record.accepted_scientific_name}</i></p>
          )}
          <span className="catalogue-detail__status">Present in Malaysia</span>
        </div>
      </header>

      <div className="catalogue-detail__body">
        <section>
          <h3>Identifying characteristics</h3>
          <p>{detail.identifying_characteristics}</p>
        </section>
        <section>
          <h3>Typical habitat</h3>
          <p>{detail.typical_habitat}</p>
        </section>
        <section>
          <h3>Documented impacts</h3>
          <p>{detail.documented_impacts}</p>
          <p>Formal severity assessment not available</p>
        </section>
        <section>
          <h3>Safe response guidance</h3>
          <ul>{detail.safe_response_guidance.map((step) => <li key={step}>{step}</li>)}</ul>
          <p>No beginner-safe active action is provided.</p>
          <p>Outside a mapped protected area does not mean removal is permitted. Confirm permission first.</p>
        </section>
        <section>
          <h3>Sources and credits</h3>
          <ul className="catalogue-sources">
            {cited.map((source) => (
              <li key={source.source_id}>
                <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
                <span>{source.publisher} · {source.source_id}</span>
                {source.reuse_status && <span>{source.reuse_status}</span>}
              </li>
            ))}
          </ul>
          {image ? (
            <ImageAttribution attribution={image} />
          ) : <p>Reference image unavailable pending reviewed attribution.</p>}
          <p>Catalogue v{dataset.catalogue_version} · last reviewed {detail.reviewed_at}</p>
        </section>
        <section className="catalogue-detail__places">
          <h3>Where it is recorded</h3>
          <p>Browse mapped parks, forests and woodlands to see historical occurrence
            associations for invasive plants like this one.</p>
          <Link to="/places">Browse mapped places</Link>
        </section>
      </div>
    </article>
  )
}

function ImageAttribution({ attribution }: { attribution: ApprovedCatalogueAsset }) {
  const source = /^https?:\/\//.test(attribution.source_url_or_identifier) ? (
    <a href={attribution.source_url_or_identifier} target="_blank" rel="noreferrer">
      {attribution.source_title}
    </a>
  ) : attribution.source_title
  return (
    <p>
      Image: {attribution.creator} · {attribution.licence} · {source}
      {' '}· reviewed {attribution.reviewed_at} · resized for offline use
    </p>
  )
}
