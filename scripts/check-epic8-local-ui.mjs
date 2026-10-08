/** Actual ScanResultPage -> real local API, fixture scan result and controlled provider failures. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createServer as netServer } from 'node:net'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readFile, mkdir } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { build } from 'esbuild'
import { chromium } from '@playwright/test'

const root = fileURLToPath(new URL('..', import.meta.url))
const reservePort = () => new Promise(resolve => {
  const server = netServer()
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port
    server.close(() => resolve(port))
  })
})
const apiPort = await reservePort()
const apiBase = `http://127.0.0.1:${apiPort}`
const python = process.env.EPIC8_TEST_PYTHON ?? 'python3'
const backendCode = `
import logging
logging.disable(logging.CRITICAL)
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.routers.plant_assistant import router
from app.config import Settings,get_settings
from pydantic import SecretStr
import httpx
from app.core.rate_limit import rate_limiter
import uvicorn
s=Settings(_env_file=None,assistant_generation_enabled=False,assistant_judge_enabled=False,assistant_generation_free_tier=False,assistant_generation_key=None,assistant_generation_model=None,assistant_judge_model=None)
controlled=[]
original_client=httpx.AsyncClient
def transport(request):
    controlled.append(str(request.url))
    return httpx.Response(503 if "test-judge:" in str(request.url) else 429)
httpx.AsyncClient=lambda **kw:original_client(transport=httpx.MockTransport(transport),**kw)
a=FastAPI();a.include_router(router)
a.add_middleware(CORSMiddleware,allow_origin_regex=r"http://127\\.0\\.0\\.1:\\d+",allow_methods=["POST"],allow_headers=["content-type"])
a.dependency_overrides[get_settings]=lambda:s
@a.post("/test/failure")
def failure(body:dict):
    enabled=body.get("mode")!="off"
    s.assistant_judge_enabled=enabled;s.assistant_generation_enabled=enabled
    s.assistant_generation_free_tier=enabled
    s.assistant_generation_key=SecretStr("test-placeholder") if enabled else None
    s.assistant_judge_model="test-judge";s.assistant_generation_model="test-generation"
    controlled.clear()
    return {"controlled_calls":0}
@a.get("/test/status")
def status():return {"controlled_calls":len(controlled),"external_provider_calls":0}
rate_limiter.enabled=False # isolated test process only
uvicorn.run(a,host="127.0.0.1",port=${apiPort},log_level="error")
`
const backend = spawn(python, ['-c', backendCode], {
  cwd: root, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONPATH: `${root}/backend` },
  stdio: ['ignore', 'ignore', 'pipe'],
})
let backendError = ''
backend.stderr.on('data', chunk => { backendError += chunk.toString() })
let browser, server
let completed = 0
const passed = label => { completed++; console.log(`PASS ${label}`) }
try {
  let ready = false
  for (let i = 0; i < 50; i++) {
    if (backend.exitCode !== null) throw new Error(`Backend exited: ${backendError}`)
    try { if ((await fetch(`${apiBase}/openapi.json`)).ok) { ready = true; break } } catch { /* bounded startup polling */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert(ready, 'Local backend readiness timeout')
  const bundle = await build({
    absWorkingDir: root, write: false, bundle: true, format: 'iife', outfile: '/tmp/epic8-in-memory.js',
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {ScanResultPage} from './src/features/scan/ScanResultPage';
      import {useScan} from './src/features/scan/scan-store';
      import {MemoryRouter} from 'react-router-dom';
      import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
      import {findApprovedSpecies} from './shared/catalogue';
      import './src/styles/global.css';
      const params=new URLSearchParams(location.search);
      const species=params.get('species')||'mikania-micrantha';
      const approved=findApprovedSpecies({speciesId:species});
      const result={outcome:params.get('outcome')||'target',speciesId:species,
        scientificName:approved?.scientific_name,confidence:Number(params.get('confidence')||'.95'),
        modelVersion:'isolated-ui-test',reportable:true};
      useScan.setState({result,captureId:'isolated-scan',step:'result'});
      window.setEpic8Result=patch=>useScan.setState({result:{...useScan.getState().result,...patch}});
      createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/scan/result']}><ScanResultPage/></MemoryRouter>
      </QueryClientProvider>);` },
    alias: { '@': `${root}/src`, '@shared': `${root}/shared` },
    loader: { '.woff': 'dataurl', '.woff2': 'dataurl' },
    define: { 'import.meta.env': JSON.stringify({ DEV: false, VITE_ENABLE_MOCKS: 'false', VITE_API_BASE_URL: apiBase }) },
  })
  const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text
  const css = bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? ''
  server = createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname
    if (pathname === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(js); return }
    if (pathname === '/bundle.css') { response.setHeader('Content-Type', 'text/css'); response.end(css); return }
    if (/\.(?:jpg|jpeg|png|webp|svg)$/.test(pathname)) {
      const publicRoot = resolve(root, 'public')
      const path = resolve(publicRoot, '.' + pathname)
      if (path.startsWith(publicRoot + sep)) {
        try { response.setHeader('Content-Type', pathname.endsWith('.svg') ? 'image/svg+xml' : pathname.endsWith('.png') ? 'image/png' : pathname.endsWith('.webp') ? 'image/webp' : 'image/jpeg'); response.end(await readFile(path)); return } catch { /* missing fixture image */ }
      }
      response.writeHead(404); response.end(); return
    }
    response.setHeader('Content-Type', 'text/html')
    response.end('<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/bundle.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const uiBase = `http://127.0.0.1:${server.address().port}`
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const uiErrors = []
  page.on('pageerror', error => uiErrors.push(error.message))
  const requests = []
  page.on('request', request => { if (request.url().endsWith('/ask') && request.method() === 'POST') requests.push(request.postDataJSON()) })
  const open = async (query = '') => {
    await page.goto(uiBase + query)
    assert.equal(await page.locator('.scan-result__disclosure').count(), 1)
    await page.getByRole('button', { name: 'Ask about this plant', exact: true }).click()
  }
  const ask = async question => {
    await page.getByLabel('Your question').fill(question)
    const response = page.waitForResponse(r => r.url().endsWith('/ask') && r.request().method() === 'POST')
    await page.getByRole('button', { name: 'Ask question', exact: true }).click()
    const real = await response
    assert.equal(real.status(), 200)
    const body = await real.json()
    await page.locator('.plant-assistant__answer').waitFor()
    assert.equal(await page.locator('.plant-assistant__answer').innerText(), body.answer)
    return body
  }
  await open()
  const nextSuggested = page.waitForResponse(r => r.url().endsWith('/ask'))
  await page.getByRole('button', { name: 'Where does it grow?', exact: true }).click()
  assert.equal((await (await nextSuggested).json()).status, 'fallback')
  await page.locator('.plant-assistant__answer').waitFor()
  passed('actual ScanResultPage opens assistant and suggested question reaches actual API')
  let body = await ask('When does it flower?')
  assert.equal(body.status, 'insufficient_evidence')
  assert(body.sources.length > 0)
  assert((await page.locator('.plant-assistant__coverage').innerText()).includes('Identification, Habitat, Impact, Spread pathways, Safe response'))
  assert.equal(await page.getByRole('heading', { name: 'Related sources' }).count(), 1)
  assert.equal(requests.at(-1).speciesId, 'mikania-micrantha')
  assert.equal(requests.at(-1).classifierConfidence, .95)
  passed('insufficient with real related sources, covered topics and scanned context')
  body = await ask('ZXQVVJ')
  assert.equal(body.sources.length, 0)
  assert.equal(await page.locator('.plant-assistant__coverage').count(), 1)
  passed('insufficient with no useful source still shows runtime topics')
  body = await ask('Does it spread by water?')
  assert.equal(body.status, 'fallback')
  assert.equal(await page.getByRole('link', { name: 'CC BY 4.0', exact: true }).count(), 1)
  assert((await page.locator('.plant-assistant__response').innerText()).includes(body.sources.find(source => source.attribution).attribution))
  assert.equal(await page.locator('.plant-assistant__coverage').count(), 0)
  const sourceLinks = await page.locator('.plant-assistant__response ul a').evaluateAll(links => links.map(a => ({href:a.href,target:a.target,rel:a.rel})))
  assert.equal(new Set(sourceLinks.map(a => a.href)).size, sourceLinks.length)
  assert(sourceLinks.every(a => a.href.startsWith('https://') && a.target === '_blank' && a.rel.includes('noopener')))
  assert(sourceLinks.some(a => body.sources.some(source => source.sourceUrl === a.href)))
  passed('sourced fallback, stored HTTPS links and attribution/licence retained through URL deduplication')
  await open('?species=acacia-auriculiformis')
  body = await ask('Does it spread by water?')
  assert(!body.coveredTopics.includes('spread'))
  assert(!(await page.locator('.plant-assistant__coverage').innerText()).includes('Spread pathways'))
  passed('missing spread is not inflated in API or UI coverage')
  await open('?species=asclepias-curassavica')
  body = await ask('When does it flower?')
  assert(body.coveredTopics.includes('documented_hazards'))
  assert((await page.locator('.plant-assistant__coverage').innerText()).includes('Documented hazards'))
  body = await ask('Is it poisonous?')
  assert.equal(body.answer, 'Plant tissues are toxic if eaten.')
  assert.equal(await page.locator('.plant-assistant__safety').innerText(), body.safetyBoundary)
  passed('many-topic species and sourced hazard display without safety assurance')
  for (const query of ['?species=unknown', '?outcome=other_plant', '?outcome=uncertain']) {
    const before = requests.length
    await open(query)
    assert((await page.locator('.plant-assistant').getByRole('status').innerText()).includes('species-specific assistant guidance is unavailable'))
    assert.equal(await page.getByLabel('Your question').count(), 0)
    assert.equal(await page.locator('.plant-assistant__coverage').count(), 0)
    assert.equal(requests.length, before)
    passed(`unsupported scan ${query}`)
  }
  // Current-session controls only; this does NOT validate generated depth quality.
  await open()
  await ask('Where does it grow?')
  for (const variant of ['Where does it grow?', '  WHERE DOES IT GROW?  ']) {
    const before = requests.length
    await page.getByLabel('Your question').fill(variant)
    await page.getByRole('button', { name: 'Ask question', exact: true }).click()
    await page.locator('.plant-assistant__repeat').waitFor()
    assert.equal(requests.length, before)
  }
  let next = page.waitForResponse(r => r.url().endsWith('/ask') && r.request().method() === 'POST')
  await page.getByRole('button', { name: 'Simpler explanation', exact: true }).click()
  body = await (await next).json()
  await page.locator('.plant-assistant__answer').waitFor()
  assert.equal(requests.at(-1).depth, 'simpler')
  assert.equal(body.status, 'fallback')
  next = page.waitForResponse(r => r.url().endsWith('/ask') && r.request().method() === 'POST')
  await page.getByRole('button', { name: 'Standard explanation', exact: true }).click()
  await next
  assert.equal(requests.at(-1).depth, 'standard')
  await page.locator('.plant-assistant__answer').waitFor()
  next = page.waitForResponse(r => r.url().endsWith('/ask') && r.request().method() === 'POST')
  await page.getByRole('button', { name: 'More detail', exact: true }).click()
  await next
  assert.equal(requests.at(-1).depth, 'detailed')
  await page.locator('.plant-assistant__answer').waitFor()
  await ask('What does it look like?')
  assert.equal(await page.locator('.plant-assistant__repeat').count(), 0)
  await open()
  await ask('Where does it grow?')
  assert.equal(await page.locator('.plant-assistant__repeat').count(), 0)
  passed('normalized repeats, all three depth requests, different question and fresh-session reset')
  await page.evaluate(() => window.setEpic8Result({speciesId:'asclepias-curassavica',scientificName:'Asclepias curassavica'}))
  await page.getByRole('button', { name: 'Ask about this plant', exact: true }).waitFor()
  assert.equal(await page.locator('.plant-assistant__answer').count(), 0)
  await page.getByRole('button', { name: 'Ask about this plant', exact: true }).click()
  body = await ask('Where does it grow?')
  assert.equal(requests.at(-1).speciesId, 'asclepias-curassavica')
  assert(body.sources.every(s => s.chunkId.startsWith('CAT-asclepias-curassavica-')))
  await page.evaluate(() => window.setEpic8Result({confidence:.1}))
  await page.getByRole('button', { name: 'Ask about this plant', exact: true }).click()
  body = await ask('Where does it grow?')
  assert.equal(body.status, 'unsupported_scan')
  assert.equal(requests.at(-1).classifierConfidence, .1)
  assert.equal(body.sources.length, 0)
  passed('same-capture species/confidence switch clears stale answers and low-confidence API refuses')
  await open()
  body = await ask('Are its leaves purple?')
  assert.equal(body.status, 'insufficient_evidence')
  passed('required semantic review with missing judge does not become a botanical guess')
  await fetch(`${apiBase}/test/failure`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'controlled'})})
  body = await ask('Are its leaves purple?')
  assert.equal(body.status, 'insufficient_evidence')
  assert.equal((await (await fetch(`${apiBase}/test/status`)).json()).controlled_calls, 1)
  passed('actual judge adapter controlled503 reaches UI limitation with no generation')
  await fetch(`${apiBase}/test/failure`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'controlled'})})
  body = await ask('Where does it grow?')
  assert.equal(body.status, 'fallback')
  assert.equal((await (await fetch(`${apiBase}/test/status`)).json()).controlled_calls, 1)
  assert.equal(await page.locator('.plant-assistant__response h3').first().innerText(), 'Source information')
  passed('actual generation adapter controlled429 yields understandable approved-source fallback')
  await fetch(`${apiBase}/test/failure`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'off'})})
  await page.route('**/api/v1/plant-assistant/ask', async route => { await new Promise(resolve => setTimeout(resolve, 350)); await route.continue() })
  await page.getByLabel('Your question').fill('What does it look like?')
  const pendingResponse = page.waitForResponse(r => r.url().endsWith('/ask'))
  await page.getByRole('button', {name:'Ask question',exact:true}).click()
  assert.equal(await page.getByRole('button', {name:'Checking the approved information…',exact:true}).isDisabled(), true)
  assert.equal(await page.locator('.plant-assistant__answer').count(), 0)
  await pendingResponse; await page.locator('.plant-assistant__answer').waitFor()
  await page.unroute('**/api/v1/plant-assistant/ask')
  await page.route('**/api/v1/plant-assistant/ask', route => route.abort('failed'))
  await page.getByLabel('Your question').fill('How does it spread?')
  await page.getByRole('button', {name:'Ask question',exact:true}).click()
  await page.getByRole('alert').waitFor()
  assert((await page.getByRole('alert').innerText()).includes('Check your connection and try again'))
  assert.equal(await page.locator('.plant-assistant__answer').count(), 0)
  await page.unroute('**/api/v1/plant-assistant/ask')
  passed('loading disables controls and network error is readable without stale answer')
  await open()
  body = await ask('Can I leave stem pieces on damp ground?')
  const protectedAnswer = body.answer
  const boundary = body.safetyBoundary
  for (const [label,depth] of [['Simpler explanation','simpler'],['Standard explanation','standard'],['More detail','detailed']]) {
    const response = page.waitForResponse(r => r.url().endsWith('/ask'))
    await page.getByRole('button',{name:label,exact:true}).click()
    body = await (await response).json(); await page.locator('.plant-assistant__answer').waitFor()
    assert.equal(requests.at(-1).depth, depth)
    assert.equal(body.answer, protectedAnswer); assert.equal(body.safetyBoundary, boundary)
  }
  passed('complete prohibition paragraph and permission boundary identical at all depths')
  const linkedSource = body.sources.find(s => s.sourceUrl.includes('business.qld.gov.au'))
  const popupPromise = page.waitForEvent('popup')
  await page.locator(`.plant-assistant__response ul a[href="${linkedSource.sourceUrl}"]`).click()
  const popup = await popupPromise
  try {
    await popup.waitForURL(linkedSource.sourceUrl, {waitUntil:'domcontentloaded',timeout:15_000})
    assert.equal(popup.url(), linkedSource.sourceUrl)
    passed('stored government source link opens its actual external page in a new tab')
  } finally { await popup.close() }
  for (const width of [375,1280]) {
    await page.setViewportSize({width,height:900})
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    const box = await page.locator('.plant-assistant').boundingBox()
    assert(box.width <= width && box.x >= 0)
    await page.locator('.plant-assistant__safety').scrollIntoViewIfNeeded()
    assert.equal(await page.locator('.plant-assistant__safety').innerText(), boundary)
    if (process.env.EPIC8_UI_SCREENSHOT_DIR) {
      await mkdir(process.env.EPIC8_UI_SCREENSHOT_DIR,{recursive:true})
      await page.locator('.plant-assistant').screenshot({path:resolve(process.env.EPIC8_UI_SCREENSHOT_DIR,`assistant-${width}.png`)})
    }
  }
  assert.deepEqual(uiErrors, [])
  passed('mobile375/desktop1280 no horizontal overflow, real styling and no page errors')
  console.log(`RESULT ${completed} browser groups PASS; ${requests.length} real API posts; live Gemini calls 0`)
} finally {
  await browser?.close()
  if (server) await new Promise(resolve => server.close(resolve))
  const exited = new Promise(resolve => backend.once('exit', resolve))
  if (backend.exitCode === null) { backend.kill('SIGTERM'); await exited }
  console.log('Local browser/server/backend stopped')
}
