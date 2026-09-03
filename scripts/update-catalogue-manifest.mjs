#!/usr/bin/env node
// Refresh shared/catalogue/catalogue-manifest.json — recompute SHA-256
// checksums for plant-status.json and plant-guidance.json, and copy the
// catalogue_version / model_version / last_reviewed values from
// plant-status.json into the manifest. Intended as the only sanctioned way
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
const manifestPath = resolve(catalogueDir, 'catalogue-manifest.json')

const statusRaw = readFileSync(statusPath)
const guidanceRaw = readFileSync(guidancePath)
const status = JSON.parse(statusRaw.toString('utf-8'))
const guidance = JSON.parse(guidanceRaw.toString('utf-8'))

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

const manifest = {
  $schema: './schemas/catalogue-manifest.schema.json',
  schema_version: 'invatrace.catalogue.manifest.v1',
  catalogue_version: status.catalogue_version,
  content_version: status.catalogue_version,
  model_version: status.model_version,
  last_reviewed: status.last_reviewed,
  files: {
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
console.log(`  plant-status.json sha256: ${manifest.files['plant-status.json'].sha256}`)
console.log(`  plant-guidance.json sha256: ${manifest.files['plant-guidance.json'].sha256}`)
