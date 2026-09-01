import { createHash } from 'node:crypto'
import { access, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const kitRoot = process.env.PULIH_MODEL_KIT_PATH
  ? resolve(process.env.PULIH_MODEL_KIT_PATH)
  : join(projectRoot, 'vendor', 'PULIH_Model1_v4_FP16_Web_Kit')
const modelRoot = join(kitRoot, 'model')
const outputRoot = join(projectRoot, 'public', 'models', 'pulih-model1-v4')
const modelName = 'efficientnet_v2_s_oe_v4_31class_web_fp16.onnx'
const chunkBytes = 20 * 1024 * 1024

async function verifyPreparedAssets() {
  const manifest = JSON.parse(
    await readFile(join(outputRoot, 'runtime-manifest.json'), 'utf8'),
  )
  if (
    manifest.schemaVersion !== 'invatrace.pulih-model-runtime.v1'
    || !Number.isSafeInteger(manifest.bytes)
    || manifest.bytes < 1
    || !Array.isArray(manifest.chunks)
    || manifest.chunks.length < 1
  ) {
    throw new Error('Prepared PULIH model manifest is invalid.')
  }

  const digest = createHash('sha256')
  let totalBytes = 0
  for (const chunk of manifest.chunks) {
    if (typeof chunk.name !== 'string' || !Number.isSafeInteger(chunk.bytes) || chunk.bytes < 1) {
      throw new Error('Prepared PULIH model chunk metadata is invalid.')
    }
    const bytes = await readFile(join(outputRoot, chunk.name))
    if (bytes.length !== chunk.bytes) {
      throw new Error(`Prepared PULIH model chunk ${chunk.name} has an invalid size.`)
    }
    digest.update(bytes)
    totalBytes += bytes.length
  }
  if (totalBytes !== manifest.bytes || digest.digest('hex') !== manifest.sha256) {
    throw new Error('Prepared PULIH model checksum mismatch.')
  }

  await Promise.all([
    'class_catalog.json',
    'inference_config.json',
    'open_set_rejection_config_v1.json',
    'species_31.json',
  ].map((name) => access(join(outputRoot, name))))
  console.log(`Verified ${manifest.chunks.length} prepared PULIH model chunks (${totalBytes} bytes).`)
}

try {
  await access(join(modelRoot, modelName))
} catch {
  await verifyPreparedAssets()
  process.exit(0)
}

const checksumLines = (await readFile(join(kitRoot, 'checksums.sha256'), 'utf8'))
  .split(/\r?\n/)
  .filter(Boolean)
const expectedLine = checksumLines.find((line) => line.endsWith(`model/${modelName}`))
if (!expectedLine) throw new Error(`Missing checksum for ${modelName}`)
const expectedSha256 = expectedLine.split(/\s+/)[0]

const model = await readFile(join(modelRoot, modelName))
const actualSha256 = createHash('sha256').update(model).digest('hex')
if (actualSha256 !== expectedSha256) {
  throw new Error(`PULIH model checksum mismatch: expected ${expectedSha256}, got ${actualSha256}`)
}

await rm(outputRoot, { recursive: true, force: true })
await mkdir(outputRoot, { recursive: true })

const runtimeFiles = [
  'class_catalog.json',
  'inference_config.json',
  'open_set_rejection_config_v1.json',
  'species_31.json',
]
await Promise.all(runtimeFiles.map((name) => cp(join(modelRoot, name), join(outputRoot, name))))

const chunks = []
for (let offset = 0, index = 0; offset < model.length; offset += chunkBytes, index += 1) {
  const name = `${modelName}.part-${String(index).padStart(3, '0')}`
  const part = model.subarray(offset, Math.min(offset + chunkBytes, model.length))
  await writeFile(join(outputRoot, name), part)
  chunks.push({ name, bytes: part.length })
}

const runtimeManifest = {
  schemaVersion: 'invatrace.pulih-model-runtime.v1',
  modelVersion: 'oe_v4_31class_web_fp16',
  modelFile: modelName,
  sha256: actualSha256,
  bytes: model.length,
  chunks,
  sourceKit: relative(projectRoot, kitRoot),
}
await writeFile(
  join(outputRoot, 'runtime-manifest.json'),
  `${JSON.stringify(runtimeManifest, null, 2)}\n`,
)

console.log(`Prepared ${chunks.length} verified PULIH model chunks (${model.length} bytes).`)
