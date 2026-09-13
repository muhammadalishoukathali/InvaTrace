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
const manifestPath = resolve(catalogueDir, 'catalogue-manifest.json')

const statusRaw = readFileSync(statusPath)
const guidanceRaw = readFileSync(guidancePath)
const approvedRaw = readFileSync(approvedPath)
const status = JSON.parse(statusRaw.toString('utf-8'))
const guidance = JSON.parse(guidanceRaw.toString('utf-8'))
const approved = JSON.parse(approvedRaw.toString('utf-8'))
const approvedIds = new Set(approved.records.map((record) => record.species_id))

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const assets = guidance.plants
  .filter((plant) => approvedIds.has(plant.plant_id.replaceAll('_', '-')) && plant.reference_image)
  .map((plant) => {
    const assetPath = resolve(root, 'public', plant.reference_image.replace(/^\//, ''))
    const bytes = readFileSync(assetPath)
    const base = {
      url: plant.reference_image,
      sha256: sha256(bytes),
      byte_length: bytes.length,
    }
    const attribution = plant.reference_image_attribution
    const required = ['creator', 'licence', 'source_title', 'source_url_or_identifier', 'reviewed_at']
    if (!attribution || !required.every((field) => typeof attribution[field] === 'string' && attribution[field].trim())) {
      return { ...base, review_status: 'provenance_pending' }
    }
    return {
      ...base,
      review_status: 'approved',
      creator: attribution.creator.trim(),
      licence: attribution.licence.trim(),
      source_title: attribution.source_title.trim(),
      source_url_or_identifier: attribution.source_url_or_identifier.trim(),
      reviewed_at: attribution.reviewed_at.trim(),
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
  },
}

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
console.log(`wrote ${manifestPath}`)
console.log(`  catalogue_version: ${manifest.catalogue_version}`)
console.log(`  approved-species.json sha256: ${manifest.files['approved-species.json'].sha256}`)
console.log(`  plant-status.json sha256: ${manifest.files['plant-status.json'].sha256}`)
console.log(`  plant-guidance.json sha256: ${manifest.files['plant-guidance.json'].sha256}`)
