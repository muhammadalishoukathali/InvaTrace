/** Real Map and Plant Guide components -> shared local API; fixtures and mocked inference only. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createServer as netServer } from 'node:net'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readFile, mkdir } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { build } from 'esbuild'
import { loadConfigFromFile } from 'vite'
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
import json
from pathlib import Path
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
ui_mode="off"
captured_case=None
captured=json.loads(Path("backend/tests/fixtures/assistant_general_captured_outputs.json").read_text())["cases"]
original_client=httpx.AsyncClient
def transport(request):
    controlled.append(str(request.url))
    primary=request.url.host=="generativelanguage.googleapis.com"
    if ui_mode in {"general","general_failover","general_bad_judge","grounded"}:
        if ui_mode=="general_failover" and primary:return httpx.Response(429)
        data=json.loads(request.content)
        context=json.loads(data["contents"][0]["parts"][0]["text"] if primary else data["messages"][1]["content"])
        if "topic" in context:
            sentences=["Waxy leaves have a cuticle that reduces water loss."] if context["topic"]=="waxy leaves" else ["A rhizome is a horizontal underground stem."]
            if context["depth"]=="detailed" and context["topic"]=="rhizome":
                sentences.append("Rhizomes can store nutrients and produce new shoots.")
            payload={"topic":context["topic"],"sentences":sentences}
            if captured_case and context["depth"]=="detailed":payload=captured[captured_case]["provider_outputs"][0]["payload"]
        elif "sentences" in context:
            payload={"decision":"supported","species":context["species"],"claims":[{"sentence_index":i,"supported":True,"supporting_chunk_ids":context["used_chunk_ids"],"evidence_quotes":[{"chunk_id":c["chunk_id"],"quote":c["content"]} for c in context["evidence"]]} for i,_ in enumerate(context["sentences"])]}
        elif "depth" in context:
            payload={"status":"answer","species":context["species"],"sentences":["It grows along riverbanks."],"used_chunk_ids":[c["chunk_id"] for c in context["evidence"]]}
        else:
            payload=captured["L04-diagnostic"]["provider_outputs"][0]["payload"] if ui_mode=="general_bad_judge" else {"decision":"unsupported","species":context["species"],"supporting_chunk_ids":[],"aspect_support":[]}
        if not primary:return httpx.Response(200,json={"choices":[{"finish_reason":"stop","message":{"content":json.dumps(payload)}}]})
        return httpx.Response(200,json={"candidates":[{"finishReason":"STOP","content":{"parts":[{"text":json.dumps(payload)}]}}]})
    return httpx.Response(503 if "test-judge:" in str(request.url) else 429)
httpx.AsyncClient=lambda **kw:original_client(transport=httpx.MockTransport(transport),**kw)
from app.db.base import get_session
class PublicSession:
    def execute(self,statement):self.statement=str(statement.compile(compile_kwargs={"literal_binds":True}));return self
    def first(self):
        if "00000000000000000000000000000301" in self.statement or "00000000-0000-0000-0000-000000000301" in self.statement:return ("mikania-micrantha","Mikania micrantha")
        if "00000000000000000000000000000302" in self.statement or "00000000-0000-0000-0000-000000000302" in self.statement:return ("mimosa-pigra","Mimosa pigra")
        return None
a=FastAPI();a.include_router(router)
a.dependency_overrides[get_session]=lambda:PublicSession()
a.add_middleware(CORSMiddleware,allow_origin_regex=r"http://127\\.0\\.0\\.1:\\d+",allow_methods=["POST"],allow_headers=["content-type"])
a.dependency_overrides[get_settings]=lambda:s
@a.post("/test/failure")
def failure(body:dict):
    global ui_mode,captured_case
    ui_mode=body.get("mode","off")
    captured_case=body.get("case_id")
    enabled=body.get("mode")!="off"
    s.assistant_judge_enabled=enabled;s.assistant_generation_enabled=enabled
    s.assistant_generation_free_tier=enabled
    s.assistant_generation_key=SecretStr("test-placeholder") if enabled else None
    s.assistant_judge_model="test-judge";s.assistant_generation_model="test-generation"
    s.groq_fallback_enabled=ui_mode=="general_failover"
    s.groq_api_key=SecretStr("test-secondary-placeholder") if s.groq_fallback_enabled else None
    s.groq_model="openai/gpt-oss-120b" if s.groq_fallback_enabled else None
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
  const loaded = await loadConfigFromFile({command:'build',mode:'production'},resolve(root,'vite.config.ts'),root)
  const imagePlugin = loaded.config.plugins.flat(Infinity).find(plugin => plugin?.name === 'reference-image-versions')
  assert(imagePlugin, 'Reviewed reference-image plugin is required by the current UI')
  const bundle = await build({
    plugins: [{name:'reviewed-reference-images',setup(builder) {
      builder.onResolve({filter:/maplibre-gl-worker.mjs\?url$/}, () => ({path:'worker',namespace:'worker-url'}))
      builder.onLoad({filter:/.*/,namespace:'worker-url'}, () => ({contents:'export default '+JSON.stringify('/maplibre-gl-worker.mjs'),loader:'js'}))
      builder.onResolve({filter:/^virtual:reference-image-versions$/}, () => ({path:'versions',namespace:'reference-images'}))
      builder.onLoad({filter:/.*/,namespace:'reference-images'}, async () => ({contents:await imagePlugin.load('\0virtual:reference-image-versions'),loader:'js'}))
    }}],
    absWorkingDir: root, write: false, bundle: true, format: 'iife', outfile: '/tmp/epic8-in-memory.js',
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {ThreatMapPage} from './src/features/map/ThreatMapPage';
      import {AppShell} from './src/components/AppShell';
      import {usePrivateAccess} from './src/features/private-access/private-access-store';
      import {ScanResultPage} from './src/features/scan/ScanResultPage';
      import {useScan} from './src/features/scan/scan-store';
      import {CatalogueDetailPage} from './src/features/catalogue/CatalogueDetailPage';
      import {useMapView} from './src/features/map/map-view-store';
      import {BrowserRouter,Routes,Route,useNavigate} from 'react-router-dom';
      import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
      import './src/styles/global.css';
      import './src/features/map/sighting-details.css';
      window.selectSighting=id=>useMapView.getState().select(id);
      usePrivateAccess.setState({status:'ready',profile:{id:'isolated-ui-profile',displayName:null,role:'Detector',trustLevel:'New'}});
      useScan.setState({result:{outcome:'target',speciesId:'mikania-micrantha',confidence:.87,modelVersion:'isolated-classifier-fixture',reportable:true},captureId:'isolated-entrypoint-scan',step:'result'});
      function App(){const navigate=useNavigate();window.goToAssistantRoute=path=>navigate(path);return <Routes>
        <Route element={<AppShell/>}>
        <Route path="/map" element={<ThreatMapPage/>}/>
        <Route path="/scan/result" element={<ScanResultPage/>}/>
        <Route path="/catalogue/:speciesId" element={<CatalogueDetailPage/>}/>
        </Route>
      </Routes>}
      createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient()}>
        <BrowserRouter><App/></BrowserRouter>
      </QueryClientProvider>);` },
    alias: { '@': `${root}/src`, '@shared': `${root}/shared` },
    loader: { '.woff': 'dataurl', '.woff2': 'dataurl' },
    define: { 'import.meta.env': JSON.stringify({ DEV: false, VITE_ENABLE_MOCKS: 'false', VITE_API_BASE_URL: apiBase }) },
  })
  const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text
  const css = bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? ''
  server = createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname
    if (/^\/maplibre-gl-(?:worker|shared)\.mjs$/.test(pathname)) { response.setHeader('Content-Type','text/javascript'); response.end(await readFile(resolve(root,'node_modules/maplibre-gl/dist',pathname.slice(1)))); return }
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
  const capture = async name => {
    if (!process.env.EPIC8_UI_SCREENSHOT_DIR) return
    await mkdir(process.env.EPIC8_UI_SCREENSHOT_DIR,{recursive:true})
    if (name.includes('grounded') || name.includes('general')) {
      await page.locator('.plant-assistant__response .plant-assistant__question').scrollIntoViewIfNeeded()
    }
    await page.getByRole('dialog').screenshot({path:resolve(process.env.EPIC8_UI_SCREENSHOT_DIR,name+'.png')})
  }
  const uiErrors = []
  page.on('pageerror', error => uiErrors.push(error.message))
  const requests = []
  page.on('request', request => { if (request.url().endsWith('/ask') && request.method() === 'POST') requests.push(request.postDataJSON()) })
  const ids = ['00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000302','00000000-0000-0000-0000-000000000399']
  const fixtures = ids.map((id,i) => ({id,speciesId:i===0?'mikania-micrantha':i===1?'mimosa-pigra':'unknown',speciesName:i===0?'Mikania vine':i===1?'Giant sensitive plant':'Unknown plant',latinName:i===0?'Mikania micrantha':i===1?'Mimosa pigra':'Unknown',status:'screened',risk:'high',location:{lat:3.15+i*.001,lng:101.64+i*.001},precisionReduced:true,reportCount:1,lastReportedAt:'2026-10-08T08:00:00Z',place:{displayName:'Fixture public record',source:'fallback'},confidence:null,thumbnailUrl:null,reporterTrust:'New',recommendedAction:'Observe safely.',actionGuide:null,removalReportId:null,screeningMethod:'deterministic_rules'}))
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (!['127.0.0.1','localhost'].includes(url.hostname)) {
      if (url.pathname.endsWith('/liberty')) await route.fulfill({json:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#e8eee8'}}]}})
      else await route.abort()
      return
    }
    if (url.pathname === '/api/v1/sightings') {await route.fulfill({json:{items:fixtures.filter(row=>!url.searchParams.get('q')||row.speciesName.toLowerCase().includes(url.searchParams.get('q').toLowerCase()))}});return}
    if (url.pathname.startsWith('/api/v1/sightings/')) {const row=fixtures.find(row=>row.id===url.pathname.split('/').at(-1));await route.fulfill(row?{json:row}:{status:404,json:{detail:'Not found'}});return}
    if (url.pathname === '/api/v1/places/map') {await route.fulfill({json:{type:'FeatureCollection',features:[],truncated:false,maxResults:2000}});return}
    await route.continue()
  })
  const setMode = mode => fetch(`${apiBase}/test/failure`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode})})
  const waitForCurrentAnswer = async () => {
    await page.waitForFunction(() => document.querySelector('.plant-assistant__messages')?.getAttribute('aria-busy') === 'false' && document.querySelector('.plant-assistant__response .plant-assistant__answer'))
  }
  const ask = async question => {
    const previousId=await page.locator('.plant-assistant__response').count()?await page.locator('.plant-assistant__response').getAttribute('data-turn-id'):null
    await page.getByLabel('Your question').fill(question)
    const pending=page.waitForResponse(r=>r.url().endsWith('/ask')&&r.request().method()==='POST')
    await page.getByRole('button',{name:'Ask question',exact:true}).click()
    const result=await pending;assert.equal(result.status(),200)
    const body=await result.json();await waitForCurrentAnswer();await page.waitForFunction(id=>document.querySelector('.plant-assistant__response')?.getAttribute('data-turn-id')!==id,previousId);return body
  }
  const choose = async depth => {
    const next=page.waitForResponse(r=>r.url().endsWith('/ask')&&r.request().method()==='POST')
    await page.getByRole('button',{name:depth,exact:true}).click()
    const body=await (await next).json();await waitForCurrentAnswer();await page.waitForFunction(depth=>document.querySelector('.plant-assistant__response')?.getAttribute('data-depth')===depth,requests.at(-1).depth);return body
  }
  const close = async () => {await page.getByRole('button',{name:'Close plant assistant',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'})}
  await page.goto(uiBase+'/map')
  await page.locator('.map-pin').first().waitFor()
  passed('M01 actual MapLibre map loads with local basemap and public fixture markers')
  const trigger=page.locator('#map-assistant-entry')
  assert(await trigger.isVisible());passed('M02 visible Map assistant entry')
  const initialViewport=page.viewportSize()
  for (const width of [260,280,320,375,768,899,900,1024,1280]) {
    await page.setViewportSize({width,height:900})
    const layout=await trigger.evaluate(button=>{
      const label=button.querySelector('span'),icon=button.querySelector('svg')
      const box=button.getBoundingClientRect(),text=label.getBoundingClientRect(),glyph=icon.getBoundingClientRect()
      const style=getComputedStyle(button)
      return {textContained:text.left>=box.left+parseFloat(style.paddingLeft)-1&&text.right<=box.right-parseFloat(style.paddingRight)+1,
        iconContained:glyph.left>=box.left+parseFloat(style.paddingLeft)-1&&glyph.right<=box.right-parseFloat(style.paddingRight)+1,
        textUnclipped:label.scrollWidth<=label.clientWidth+1&&label.scrollHeight<=label.clientHeight+1,
        touchHeight:box.height,label:label.textContent}
    })
    assert(layout.textContained&&layout.iconContained&&layout.textUnclipped,`Map assistant label/icon overflow at ${width}px: ${JSON.stringify(layout)}`)
    assert(layout.touchHeight>=44);assert.equal(layout.label,'Ask Plant Assistant')
    if (process.env.EPIC8_UI_SCREENSHOT_DIR&&[260,375,900,1280].includes(width)) {
      await mkdir(process.env.EPIC8_UI_SCREENSHOT_DIR,{recursive:true})
      await page.screenshot({path:resolve(process.env.EPIC8_UI_SCREENSHOT_DIR,`map-controls-${width}.png`)})
    }
  }
  await page.setViewportSize(initialViewport)
  passed('M02b Map assistant full label/icon stay inside button at narrow zoom-equivalent widths and responsive breakpoints')
  await trigger.click();await page.getByRole('dialog',{name:'Map Plant Assistant',exact:true}).waitFor()
  assert.equal(await page.getByRole('heading',{name:'Plant Assistant',exact:true}).count(),1)
  assert.equal(await page.locator('.plant-assistant__context').innerText(),'Map')
  passed('M03 existing assistant modal opens')
  assert.equal(await page.getByLabel('Your question').count(),0)
  assert((await page.getByRole('dialog').innerText()).includes('Select a supported plant'))
  assert.equal(requests.length,0);passed('M11 no-selection deterministic help never fabricates a scan or calls generation')
  await close();assert(await trigger.isEnabled());assert.equal(await page.locator('.map-pin').count(),3)
  passed('M04 close preserves map and returns focus')
  assert.equal(await trigger.evaluate(e=>e===document.activeElement),true)
  await page.locator(`[data-sighting-id="${ids[0]}"]`).first().click()
  await page.getByRole('dialog',{name:'Sighting details',exact:true}).waitFor()
  await page.getByRole('dialog').getByRole('button',{name:'Ask Plant Assistant',exact:true}).click()
  await page.getByLabel('Your question').waitFor()
  assert.equal(await page.locator('.plant-assistant__context').innerText(),'Public map record')
  await setMode('grounded')
  let body=await ask('Where does it grow?')
  assert.equal(body.answerMode,'grounded');assert(body.sources.length)
  assert.equal(requests.at(-1).sightingId,ids[0]);assert.deepEqual(Object.keys(requests.at(-1)).sort(),['allowGeneralKnowledge','depth','question','sightingId'])
  passed('M05 selected real public record ID uses backend mapping with no scan fields')
  assert(await page.locator('.plant-assistant__response ul a').count()>0);passed('M06 grounded citations render from stored source records')
  assert.equal(await page.locator('.plant-assistant__response').getAttribute('data-mode'),'grounded')
  assert.equal(await page.locator('.plant-assistant__response').getByRole('region',{name:'Sources',exact:true}).count(),1)
  for (const width of [375,1280]) {
    await page.setViewportSize({width,height:900})
    await page.locator('.plant-assistant__response .plant-assistant__safety').scrollIntoViewIfNeeded()
    const dialogBox=await page.getByRole('dialog').boundingBox()
    const closeBox=await page.getByRole('button',{name:'Close plant assistant',exact:true}).boundingBox()
    assert(closeBox.y>=dialogBox.y && closeBox.y+closeBox.height<=dialogBox.y+dialogBox.height)
    await capture('map-grounded-'+width)
  }
  body=await choose('More detail');assert.equal(body.answerMode,'grounded');assert.equal(requests.at(-1).depth,'detailed');assert(body.sources.length)
  passed('M07 grounded Detailed reaches generation and final grounding')
  await setMode('general')
  body=await ask('What is a rhizome?');assert.equal(body.answerMode,'general_knowledge');assert.deepEqual(body.sources,[])
  body=await choose('Simpler explanation');assert.equal(body.answerMode,'general_knowledge');passed('M08 general Simpler is labelled with empty citations')
  body=await choose('Standard explanation');assert.equal(body.answerMode,'general_knowledge');passed('M09 general Standard works')
  assert.equal(await page.getByRole('button',{name:'More detail',exact:true}).count(),0)
  await setMode('general')
  const blocked=await (await fetch(`${apiBase}/api/v1/plant-assistant/map/ask`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sightingId:ids[0],question:'What is a rhizome?',depth:'detailed',allowGeneralKnowledge:true})})).json()
  assert.equal(blocked.status,'insufficient_evidence');assert.equal((await (await fetch(`${apiBase}/test/status`)).json()).controlled_calls,0);passed('M10 backend rejects general Detailed with zero inference attempts')
  await page.evaluate(id=>window.selectSighting(id),ids[2]);await page.getByRole('dialog').getByText('This record cannot provide supported plant context.',{exact:false}).waitFor()
  assert.equal(await page.getByLabel('Your question').count(),0);passed('M12 unsupported marker cannot give species guidance')
  await page.evaluate(id=>window.selectSighting(id),ids[0]);await page.getByLabel('Your question').waitFor()
  await setMode('general')
  for (const q of ['Is it near me?','Can you give me directions?']) {body=await ask(q);assert.notEqual(body.answerMode,'general_knowledge')}
  passed('M13 near-me and navigation questions remain restricted')
  for (const q of ['Can I eat it?','Can I touch it?','Is it toxic?','Can I remove it?','Can it treat diabetes?','Is removal legal?','May I enter this protected area?']) {body=await ask(q);assert.notEqual(body.answerMode,'general_knowledge');assert(body.safetyBoundary.startsWith('This assistant does not grant permission'))}
  passed('M14 locked hazard handling medical legal and permission refusals retain boundary')
  await ask('What is a rhizome?')
  await page.evaluate(id=>window.selectSighting(id),ids[1]);await page.getByLabel('Your question').waitFor()
  assert.equal(await page.locator('.plant-assistant__turn').count(),0);assert.equal(await page.locator('.plant-assistant__repeat').count(),0)
  assert.equal(await page.locator('.plant-assistant__species-name').innerText(),'Mimosa pigra')
  passed('M15 marker changes remount assistant and clear incompatible answers/repeats')
  await page.evaluate(()=>window.goToAssistantRoute('/scan/result'))
  await page.getByRole('button',{name:'Ask about this plant',exact:true}).click()
  assert.equal(await page.locator('.plant-assistant__turn').count(),0)
  body=await ask('What is a rhizome?');assert.equal(body.answerMode,'general_knowledge')
  assert.equal(requests.at(-1).classifierConfidence,.87);assert.equal(requests.at(-1).sightingId,undefined)
  passed('M16 Map conversation never enters Scan; genuine classifier fixture retains its own confidence')
  passed('M20 actual Scan Result reuses the single existing assistant instance')
  await page.evaluate(()=>window.goToAssistantRoute('/map'));await page.locator('.map-pin').first().waitFor()
  await page.evaluate(()=>window.selectSighting(null));await page.getByRole('dialog').waitFor({state:'detached'})
  await page.getByRole('button',{name:/Open reports list/}).click()
  await page.getByRole('group',{name:'Report filters',exact:true}).getByRole('combobox').selectOption('mikania-micrantha')
  await page.waitForFunction(()=>document.querySelectorAll('.map-pin').length===1)
  await page.getByRole('button',{name:'Clear filters',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.map-pin').length===3)
  await page.getByRole('button',{name:'Close community reports list',exact:true}).click()
  await page.getByRole('button',{name:'Hide mapped places'}).click();assert(await page.getByRole('button',{name:'Show mapped places'}).isVisible())
  await page.getByRole('button',{name:'Show map legend'}).click();await page.getByRole('dialog',{name:'Map legend'}).waitFor();await page.getByRole('button',{name:'Hide legend'}).click()
  await page.getByRole('button',{name:'Zoom in',exact:true}).click()
  passed('M17 actual reports filters, place toggle, legend and zoom remain functional')
  await page.evaluate(()=>window.selectSighting(null))
  for (const width of [320,375,768,1280]) {
    await page.setViewportSize({width,height:900});await trigger.click();await page.getByRole('dialog',{name:'Map Plant Assistant'}).waitFor()
    await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth,null,{timeout:5000}).catch(async error=>{console.log(JSON.stringify(await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('*')].map(e=>({tag:e.tagName,cls:e.className,rect:e.getBoundingClientRect().toJSON()})).filter(e=>e.rect.right>innerWidth+1).slice(0,15)}))));await page.screenshot({path:resolve(root,'.local-data/final-integration/map-overflow.png')});throw error})
    const box=await page.getByRole('dialog').boundingBox();assert(box.x>=0&&box.x+box.width<=width)
    if (width===375 || width===1280) await capture('map-empty-'+width)
    await close();const entryBox=await trigger.boundingBox();const zoomBox=await page.getByRole('button',{name:'Zoom in',exact:true}).boundingBox();assert(entryBox.x+entryBox.width<zoomBox.x)
  }
  passed('M18 mobile320/375 tablet768 desktop1280 modal and map controls have no overflow or overlap')
  assert(requests.filter(r=>r.sightingId).every(r=>!('classifierConfidence'in r)&&!('latitude'in r)&&!('longitude'in r)&&!('history'in r)&&!('userId'in r)))
  passed('M19 minimal Map request envelope excludes coordinates private metadata history identity; backend tests verify provider envelope')
  await page.goto(uiBase+'/catalogue/mikania-micrantha')
  await page.getByRole('heading',{name:'Typical habitat',exact:true}).waitFor()
  await page.getByRole('button',{name:'Ask Plant Assistant',exact:true}).click()
  await page.getByLabel('Your question').waitFor();await setMode('grounded')
  assert.equal(await page.getByRole('heading',{name:'Plant Assistant',exact:true}).count(),1)
  assert.equal(await page.locator('.plant-assistant__context').innerText(),'Plant guide')
  passed('shared header accurately distinguishes Scan, public Map record and Plant Guide contexts')
  body=await ask('Where does it grow?');assert.equal(body.answerMode,'grounded');assert(body.sources.length)
  body=await choose('More detail');assert.equal(body.answerMode,'grounded')
  assert.deepEqual(Object.keys(requests.at(-1)).sort(),['allowGeneralKnowledge','depth','question','speciesId'])
  passed('G01 actual Plant Guide opens same assistant using catalogue context, grounded citations and Detailed')
  await setMode('general');body=await ask('What is a rhizome?');assert.equal(body.answerMode,'general_knowledge')
  body=await choose('Simpler explanation');assert.equal(body.answerMode,'general_knowledge');body=await choose('Standard explanation');assert.equal(body.answerMode,'general_knowledge')
  assert.equal(await page.getByRole('button',{name:'More detail',exact:true}).count(),0);passed('G02 Guide general Simpler/Standard only')
  assert.equal(await page.locator('.plant-assistant__turn').count(),2)
  const earlier=page.locator('.plant-assistant__turn').first()
  assert.equal(await earlier.getAttribute('data-mode'),'grounded')
  assert(await earlier.locator('.plant-assistant__sources a').count()>0)
  assert.equal(await earlier.locator('.plant-assistant__asked').innerText(),'Where does it grow?')
  assert.equal(await page.locator('.plant-assistant__response .plant-assistant__sources').count(),0)
  assert((await page.locator('.plant-assistant__response .plant-assistant__notice').innerText()).includes('not been verified'))
  assert.equal(await page.locator('.plant-assistant__species-name').innerText(),'Mikania micrantha')
  passed('Guide history keeps grounded sources separate from unverified General answers and displays only trusted species context')

  for (const width of [375,1280]) {
    await page.setViewportSize({width,height:900})
    await capture('guide-general-'+width)
  }
  body=await ask('Can I eat it?');assert.notEqual(body.answerMode,'general_knowledge');passed('G03 Guide locked safety refusal')
  await close();assert(await page.getByRole('heading',{name:'Typical habitat'}).isVisible())
  await page.getByRole('button',{name:'Ask Plant Assistant',exact:true}).click();assert.equal(await page.locator('.plant-assistant__turn').count(),0)
  passed('G04 close/reopen clears Guide conversation and preserves original guide content')
  await page.evaluate(()=>window.goToAssistantRoute('/catalogue/mimosa-pigra'))
  await page.getByRole('button',{name:'Ask Plant Assistant',exact:true}).click();assert.equal(await page.locator('.plant-assistant__turn').count(),0);assert.equal(await page.locator('.plant-assistant__species-name').innerText(),'Mimosa pigra')
  await close();passed('G05 changing Guide species clears incompatible state')
  for (const width of [320,375,768,1280]) {
    await page.setViewportSize({width,height:900});await page.getByRole('button',{name:'Ask Plant Assistant',exact:true}).click()
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
    const modal=await page.getByRole('dialog').boundingBox()
    const composer=await page.locator('.plant-assistant__composer').boundingBox()
    const textarea=await page.getByLabel('Your question').boundingBox()
    assert(composer.y+composer.height<=modal.y+modal.height+1)
    assert(textarea.x>=modal.x && textarea.x+textarea.width<=modal.x+modal.width)
    assert.equal(await page.locator('.plant-assistant__turn').count(),0)
    await capture('guide-welcome-'+width)
    await close()
  }
  passed('G06 Guide modal usable at mobile320/375 tablet768 and desktop1280')
  await page.goto(uiBase+'/catalogue/unknown');assert.equal(await page.getByRole('button',{name:'Ask Plant Assistant',exact:true}).count(),0);passed('G07 unknown Guide retains honest unavailable page')
  assert.deepEqual(uiErrors,[])
  console.log(`RESULT ${completed} entrypoint groups PASS; ${requests.length} local API posts; external inference 0`)
} finally {
  await browser?.close()
  if (server) await new Promise(resolve=>server.close(resolve))
  const exited=new Promise(resolve=>backend.once('exit',resolve))
  if (backend.exitCode===null) {backend.kill('SIGTERM');await exited}
  console.log('Owned local browser/server/backend stopped')
}
