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
