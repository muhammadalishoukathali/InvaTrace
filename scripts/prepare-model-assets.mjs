// Runs as a "pre" hook before every dev server and build (predev,
// predev:https, predev:model-test, predev:real, prebuild in package.json).
// It verifies the reviewed catalogue reference images against
// shared/catalogue/reference-images.json and re-checks the Student33 ONNX
// model against the SHA-256 stored in its runtime manifest. Doing this on
// every run means the served model is always freshly re-verified rather than
// trusting whatever was left in public/ from before.
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const modelRoot = join(projectRoot, 'public', 'models', 'invatrace-student33-v1')

// Catalogue images are versioned independently from the classifier. Verify
// every reviewed local image here so production builds fail on missing,
// corrupted, or stale catalogue assets without coupling them to model packs.
const referenceImages = JSON.parse(
  await readFile(join(projectRoot, 'shared', 'catalogue', 'reference-images.json'), 'utf8'),
)
if (referenceImages.record_count !== 32 || referenceImages.records?.length !== 32) {
  throw new Error('The reviewed reference-image release must contain exactly 32 records.')
}
for (const image of referenceImages.records) {
  const bytes = await readFile(join(projectRoot, 'public', image.local_url.replace(/^\//u, '')))
  const actualImageSha256 = createHash('sha256').update(bytes).digest('hex')
  if (bytes.length !== image.byte_length || actualImageSha256 !== image.sha256) {
    throw new Error(`Catalogue image integrity mismatch: ${image.species_id}`)
  }
}

const manifest = JSON.parse(
  await readFile(join(modelRoot, 'runtime-manifest.json'), 'utf8'),
)
if (manifest.schemaVersion !== 'invatrace.student33-runtime.v1') {
  throw new Error(`Unsupported plant model runtime manifest schema: ${manifest.schemaVersion}`)
}

// Fail loudly rather than silently serving a corrupted or swapped-out model
// file. A bad model would fail quietly at inference time otherwise, giving
// wrong species predictions instead of an obvious build error.
const modelBytes = await readFile(join(modelRoot, manifest.modelFile))
const actualSha256 = createHash('sha256').update(modelBytes).digest('hex')
if (modelBytes.length !== manifest.bytes) {
  throw new Error(
    `Student33 model size mismatch: expected ${manifest.bytes}, got ${modelBytes.length}`,
  )
}
if (actualSha256 !== manifest.sha256) {
  throw new Error(
    `Student33 model checksum mismatch: expected ${manifest.sha256}, got ${actualSha256}`,
  )
}

console.log(`Verified Student33 ONNX model (${modelBytes.length} bytes, ${manifest.classCount} classes).`)
console.log(`Verified ${referenceImages.records.length} reviewed catalogue images.`)
