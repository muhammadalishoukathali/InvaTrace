import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import {
  approvedCatalogueAssetForSpecies,
  type ApprovedCatalogueAsset,
  approvedSpeciesDataset,
  rawGuidanceJson,
  type ApprovedSpeciesDataset,
  type CatalogueSource,
} from '@shared/catalogue'
import { loadInstalledCatalogueData } from './offline-catalogue'
import './catalogue.css'

interface GuidanceItem { text: string }
interface GuidanceRecord {
  plant_id: string
  general_information: string
  identification_note: string
  risk_flags: string[]
  actions: { protected_or_permission_unknown: { steps: GuidanceItem[] } } | null
  spread_prevention: GuidanceItem[]
  reference_image?: string
  reference_image_credit?: string
}

const bundledGuidance = (rawGuidanceJson as { plants: GuidanceRecord[] }).plants

export function CatalogueDetailPage() {
  const { speciesId = '' } = useParams()
  const [dataset, setDataset] = useState<ApprovedSpeciesDataset>(approvedSpeciesDataset)
  const [guidance, setGuidance] = useState<GuidanceRecord[]>(bundledGuidance)
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({})
  const [approvedImages, setApprovedImages] = useState<Record<string, ApprovedCatalogueAsset>>(
    () => Object.fromEntries(approvedSpeciesDataset.records.flatMap((item) => {
      const asset = approvedCatalogueAssetForSpecies(item.species_id)
      return asset ? [[asset.species_id, asset]] : []
    })),
  )
  const releasePack = useRef<(() => void) | null>(null)
  useEffect(() => {
    let active = true
    void loadInstalledCatalogueData().then((pack) => {
      if (!active || !pack) return
      setDataset(pack.approved)
      setGuidance(pack.guidance.plants as unknown as GuidanceRecord[])
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
        <Link to="/catalogue">Back to catalogue</Link>
      </section>
    )
  }
  const plant = guidance.find((item) => item.plant_id.replaceAll('_', '-') === record.species_id)
  const sources = new Map(dataset.sources.map((source) => [source.source_id, source]))
  const cited = record.evidence_source_ids
    .map((sourceId) => sources.get(sourceId))
    .filter((source): source is CatalogueSource => Boolean(source))
  const safeSteps = plant?.actions?.protected_or_permission_unknown.steps.map((item) => item.text) ?? []
  const image = approvedImages[record.species_id]

  return (
    <article className="catalogue-detail">
      <Link to="/catalogue" className="catalogue-detail__back">
        <Icon name="ChevronLeft" size={17} color="currentColor" /> Back to catalogue
      </Link>
      <header className="catalogue-detail__header">
        <div className="catalogue-detail__media">
          {image ? (
            <img src={assetUrls[image.url] ?? image.url} alt={`Reference view of ${record.scientific_name}`} />
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
          <p>{plant?.general_information ?? 'Identification characteristics have not yet been reviewed for this catalogue entry.'}</p>
          {plant?.identification_note && <p>{plant.identification_note}</p>}
        </section>
        <section>
          <h3>Habitat and recorded impact context</h3>
          <p>Reviewed habitats: {record.habitats.join(' and ')}.</p>
          <p>{record.evidence_summary}</p>
          <p>Formal severity assessment not available</p>
        </section>
        <section>
          <h3>Safe response guidance</h3>
          {safeSteps.length ? (
            <ul>{safeSteps.map((step) => <li key={step}>{step}</li>)}</ul>
          ) : <p>No beginner-safe active action is provided</p>}
          <p>Outside a mapped protected area does not mean removal is permitted. Confirm permission first.</p>
        </section>
        {plant?.spread_prevention?.length ? (
          <section>
            <h3>Spread prevention</h3>
            <ul>{plant.spread_prevention.map((item) => <li key={item.text}>{item.text}</li>)}</ul>
          </section>
        ) : null}
        <section>
          <h3>Sources and credits</h3>
          <ul className="catalogue-sources">
            {cited.map((source) => (
              <li key={source.source_id}>
                <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
                <span>{source.publisher} · {source.source_id}</span>
              </li>
            ))}
          </ul>
          {image ? (
            <ImageAttribution attribution={image} />
          ) : <p>Reference image unavailable pending reviewed attribution.</p>}
          <p>Catalogue v{dataset.catalogue_version} · last reviewed {record.status_reviewed_at}</p>
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
