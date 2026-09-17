// Exercises the on-device model loader directly (bypassing the scan UI): a
// download that fails the first time, falling back to WASM when WebGPU isn't
// available, and making sure concurrent load() calls share one session instead
// of loading the model several times over. Needs the model files to actually be
// served under /models for the fetch mocking here to mean anything.
import { expect, test } from '@playwright/test'

// Bundled into one test because all three checks share the same expensive
// model download: retrying a failed download, falling back off WebGPU, and
// deduping concurrent load() calls into a single in-flight session.
test('model runtime retries a failed download, falls back to WASM, and reuses one session', async ({ page }) => {
  test.setTimeout(45_000)
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'gpu', {
      configurable: true,
      get: () => undefined,
    })
    const realFetch = globalThis.fetch.bind(globalThis)
    let failFirstDownload = true
    globalThis.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (failFirstDownload && url.endsWith('.onnx')) {
        failFirstDownload = false
        return Promise.resolve(new Response('temporary test failure', { status: 503 }))
      }
      return realFetch(input, init)
    }
  })

  const modelRequests = new Map<string, number>()
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname
    if (!pathname.startsWith('/models/invatrace-student33-v1/')) return
    modelRequests.set(pathname, (modelRequests.get(pathname) ?? 0) + 1)
  })
  await page.goto('/private-access')
  const result = await page.evaluate(async () => {
    const { PulihModel } = await import('/src/features/scan/pulih-model.ts')
    const model = new PulihModel()
    let firstErrorCode: string | null = null
    try {
      await model.load()
    } catch (error) {
      firstErrorCode = error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : 'unknown'
    }

    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 512
    const context = canvas.getContext('2d')!
    context.fillStyle = '#2a7a3a'
    context.fillRect(0, 0, 512, 512)
    context.fillStyle = '#88cc44'
    context.beginPath()
    context.arc(256, 256, 150, 0, Math.PI * 2)
    context.fill()
    const image = await new Promise<Blob>((resolve) => {
      canvas.toBlob((blob) => resolve(blob!), 'image/jpeg', 0.85)
    })

    await Promise.all([model.load(), model.load()])
    await model.load()
    const first = await model.predict(image)
    const second = await model.predict(image)
    return {
      firstErrorCode,
      versions: [first.modelVersion, second.modelVersion],
      diagnostics: model.getDiagnostics(),
      measures: performance.getEntriesByType('measure').map((entry) => entry.name),
    }
  })

  expect(result.firstErrorCode).toBe('download')
  expect(result.versions).toEqual([
    'invatrace-student33-tinyvit5m-320-fp16',
    'invatrace-student33-tinyvit5m-320-fp16',
  ])
  expect(result.diagnostics.provider).toBe('wasm')
  expect(result.diagnostics.loadMs).toBeGreaterThan(0)
  expect(result.diagnostics.downloadMs).toBeGreaterThan(0)
  expect(result.diagnostics.lastInferenceMs).toBeGreaterThan(0)
  expect(result.measures).toEqual(expect.arrayContaining([
    'invatrace:model-download',
    'invatrace:model-load',
    'invatrace:model-inference',
  ]))
  // The model is a single file now, so the thing worth asserting is that the
  // four load() calls above shared one download. The first attempt is faked by
  // the init script and never reaches the network, so exactly one real request
  // for the .onnx is what a working session cache looks like.
  const onnxRequests = [...modelRequests.entries()]
    .filter(([path]) => path.endsWith('.onnx'))
    .reduce((sum, [, count]) => sum + count, 0)
  expect(onnxRequests).toBe(1)
})

// A poisoned cache used to be permanent: the service worker caches the model
// CacheFirst for a year, so one corrupted 200 (truncated download, proxy or
// antivirus rewriting the .onnx) failed the checksum identically on every
// later load and reloading the page never helped. The loader now treats an
// integrity failure as a cache repair job - evict, then refetch from the
// network - so the second attempt succeeds on its own.
test('a corrupted model download is evicted and re-fetched instead of failing forever', async ({ page }) => {
  test.setTimeout(45_000)
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'gpu', {
      configurable: true,
      get: () => undefined,
    })
    const realFetch = globalThis.fetch.bind(globalThis)
    const attempts: string[] = []
    ;(globalThis as unknown as { __modelFetchModes: string[] }).__modelFetchModes = attempts
    let corruptFirstDownload = true
    globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (!url.endsWith('.onnx')) return realFetch(input, init)
      attempts.push(String(init?.cache ?? 'default'))
      if (!corruptFirstDownload) return realFetch(input, init)
      corruptFirstDownload = false
      // Right length, wrong bytes: this gets past the size check and has to be
      // caught by the SHA-256 comparison.
      const real = await realFetch(input, init)
      const bytes = new Uint8Array(await real.arrayBuffer())
      bytes[0] ^= 0xff
      return new Response(bytes, {
        status: 200,
        headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes.byteLength) },
      })
    }
  })

  await page.goto('/private-access')
  const result = await page.evaluate(async () => {
    const modelUrl = '/models/invatrace-student33-v1/tinyvit5m_student33_320_fp16.onnx'
    // Stand in for the service worker's CacheFirst entry so the test can prove
    // the loader actually evicts what it found, not just that it retried.
    const cache = await caches.open('invatrace-student33-model-v1')
    await cache.put(new Request(modelUrl, { cache: 'force-cache' }), new Response(new Uint8Array([1, 2, 3])))
    const { PulihModel } = await import('/src/features/scan/pulih-model.ts')
    const model = new PulihModel()
    let loadError: string | null = null
    try {
      await model.load()
    } catch (error) {
      loadError = error instanceof Error ? error.message : String(error)
    }
    return {
      loadError,
      version: model.getDiagnostics().provider === null ? null : 'loaded',
      cachedAfterLoad: (await cache.match(modelUrl)) !== undefined,
      fetchModes: (globalThis as unknown as { __modelFetchModes: string[] }).__modelFetchModes,
    }
  })

  expect(result.loadError).toBeNull()
  expect(result.version).toBe('loaded')
  // The first attempt reads through the cache; the repair attempt must force
  // the network, otherwise it would just be handed the same bad bytes again.
  expect(result.fetchModes).toEqual(['force-cache', 'reload'])
  expect(result.cachedAfterLoad).toBe(false)
})
