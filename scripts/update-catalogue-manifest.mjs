#!/usr/bin/env node
// Refresh shared/catalogue/catalogue-manifest.json - recompute SHA-256
// checksums for the approved allowlist, legacy model metadata, and guidance.
// Catalogue release metadata comes from approved-species.json; model_version
// remains the version of the independently shipped classifier.
// to update the manifest so frontend + backend stay byte-for-byte aligned.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const catalogueDir = resolve(root, 'shared/catalogue')

const statusPath = resolve(catalogueDir, 'plant-status.json')
const guidancePath = resolve(catalogueDir, 'plant-guidance.json')
const approvedPath = resolve(catalogueDir, 'approved-species.json')
const referenceImagesPath = resolve(catalogueDir, 'reference-images.json')
const catalogueDetailsPath = resolve(catalogueDir, 'catalogue-details.json')
const manifestPath = resolve(catalogueDir, 'catalogue-manifest.json')

const statusRaw = readFileSync(statusPath)
const guidanceRaw = readFileSync(guidancePath)
const approvedRaw = readFileSync(approvedPath)
const referenceImagesRaw = readFileSync(referenceImagesPath)
const catalogueDetailsRaw = readFileSync(catalogueDetailsPath)
const status = JSON.parse(statusRaw.toString('utf-8'))
const guidance = JSON.parse(guidanceRaw.toString('utf-8'))
const approved = JSON.parse(approvedRaw.toString('utf-8'))
const referenceImages = JSON.parse(referenceImagesRaw.toString('utf-8'))
const catalogueDetails = JSON.parse(catalogueDetailsRaw.toString('utf-8'))
const approvedIds = new Set(approved.records.map((record) => record.species_id))

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
if (
  referenceImages.catalogue_version !== approved.catalogue_version
  || referenceImages.record_count !== 32
  || referenceImages.records.length !== 32
) {
  throw new Error('reference-images.json must contain exactly 32 records')
}
if (
  catalogueDetails.catalogue_version !== approved.catalogue_version
  || catalogueDetails.record_count !== 32
  || catalogueDetails.records.length !== 32
  || new Set(catalogueDetails.records.map((record) => record.species_id)).size !== 32
  || catalogueDetails.records.some((record) => !approvedIds.has(record.species_id))
) {
  throw new Error('catalogue-details.json must exactly match the approved 32-species release')
}
const assets = referenceImages.records
  .map((image) => {
    if (!approvedIds.has(image.species_id)) throw new Error(`unapproved image species: ${image.species_id}`)
    const assetPath = resolve(root, 'public', image.local_url.replace(/^\//, ''))
    const bytes = readFileSync(assetPath)
    if (sha256(bytes) !== image.sha256 || bytes.length !== image.byte_length) {
      throw new Error(`reference image integrity mismatch: ${image.species_id}`)
    }
    return {
      species_id: image.species_id,
      url: image.local_url,
      sha256: image.sha256,
      byte_length: bytes.length,
      review_status: 'approved',
      creator: image.creator,
      licence: image.licence,
      licence_url: image.licence_url,
      source_title: image.source_title,
      source_url_or_identifier: image.source_url_or_identifier,
      retrieved_at: image.retrieved_at,
      reviewed_at: image.reviewed_at,
      attribution_text: image.attribution_text,
    }
  })

const manifest = {
  $schema: './schemas/catalogue-manifest.schema.json',
  schema_version: 'invatrace.catalogue.manifest.v2',
  catalogue_version: approved.catalogue_version,
  content_version: approved.catalogue_version,
  model_version: status.model_version,
  last_reviewed: approved.reviewed_at,
  generated_at: new Date().toISOString(),
  assets,
  files: {
    'approved-species.json': {
      sha256: sha256(approvedRaw),
      byte_length: approvedRaw.length,
      schema_version: approved.schema_version,
      record_count: approved.records.length,
    },
    'plant-status.json': {
      sha256: sha256(statusRaw),
      byte_length: statusRaw.length,
      schema_version: status.schema_version,
      record_count: status.records.length,
    },
    'plant-guidance.json': {
      sha256: sha256(guidanceRaw),
      byte_length: guidanceRaw.length,
      schema_version: guidance.schema_version,
      record_count: guidance.plants.length,
    },
    'reference-images.json': {
      sha256: sha256(referenceImagesRaw),
      byte_length: referenceImagesRaw.length,
      schema_version: referenceImages.schema_version,
      record_count: referenceImages.records.length,
    },
    'catalogue-details.json': {
      sha256: sha256(catalogueDetailsRaw),
      byte_length: catalogueDetailsRaw.length,
      schema_version: catalogueDetails.schema_version,
      record_count: catalogueDetails.records.length,
    },
  },
}

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
console.log(`wrote ${manifestPath}`)
console.log(`  catalogue_version: ${manifest.catalogue_version}`)
console.log(`  approved-species.json sha256: ${manifest.files['approved-species.json'].sha256}`)
console.log(`  plant-status.json sha256: ${manifest.files['plant-status.json'].sha256}`)
console.log(`  plant-guidance.json sha256: ${manifest.files['plant-guidance.json'].sha256}`)
console.log(`  catalogue-details.json sha256: ${manifest.files['catalogue-details.json'].sha256}`)
