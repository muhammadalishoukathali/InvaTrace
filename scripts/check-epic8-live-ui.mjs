/** Explicit controlled live browser validation: approved backend model, fixture scan, bounded calls. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createServer as netServer } from 'node:net'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
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
// Resume only remaining controlled checks; preserve already recorded live calls.
const resume = process.env.EPIC8_LIVE_UI_RESUME_FROM ? JSON.parse(await readFile(resolve(root,process.env.EPIC8_LIVE_UI_RESUME_FROM),'utf8')) : null
if(resume){assert.equal(resume.provider.live_calls,13);assert.equal(resume.browser_groups,11)}
const backendCode = `
import logging,json,re
logging.disable(logging.CRITICAL)
from fastapi.middleware.cors import CORSMiddleware
from app.config import Settings,get_settings
from app.core.rate_limit import rate_limiter
from app.main import create_app
import httpx,uvicorn
s=Settings()
assert s.assistant_judge_model==s.assistant_generation_model=="gemini-3.5-flash-lite"
assert s.assistant_judge_enabled and s.assistant_generation_enabled and s.assistant_generation_free_tier and s.assistant_generation_key
mode="off" if ${resume?"True":"False"} else "live"; records=json.loads(${JSON.stringify(JSON.stringify(resume?.provider.records??[]))}); original_client=httpx.AsyncClient; original_key=s.assistant_generation_key
def clean(value):
    text=json.dumps(value).replace(original_key.get_secret_value(),"[REDACTED]")
    return json.loads(re.sub(r"\\b(?:AIza[A-Za-z0-9_-]{20,}|AQ\\.[A-Za-z0-9_-]{20,})\\b","[REDACTED]",text))
async def before(request):
    if mode=="off":raise ValueError("Provider disabled in offline/resume mode")
    assert str(request.url)=="https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent"
    if mode=="live" and sum(x["mode"]=="live" for x in records)>=13:raise ValueError("Controlled live-call budget exhausted")
    payload=json.loads(request.content)
    context=json.loads(payload["contents"][0]["parts"][0]["text"])
    records.append({"mode":mode,"phase":"grounding" if "claims" in payload["generationConfig"]["responseJsonSchema"]["properties"] else ("judge" if "decision" in payload["generationConfig"]["responseJsonSchema"]["properties"] else "generation"),"model":"gemini-3.5-flash-lite","context":clean(context)})
async def after(response):
    await response.aread()
    records[-1]["http_status"]=response.status_code
    body=response.json()
    if response.status_code==200:
        candidate=body.get("candidates",[{}])[0]
        parts=candidate.get("content",{}).get("parts",[])
        body={"finishReason":candidate.get("finishReason"),"text":"".join(p.get("text","") for p in parts if not p.get("thought")),"usageMetadata":body.get("usageMetadata",{})}
    else:body={"error":"provider failure"}
    records[-1]["provider_body"]=clean(body)
def failure_transport(request):
    payload=json.loads(request.content)
    props=payload["generationConfig"]["responseJsonSchema"]["properties"]
    judge="decision" in props
    if mode=="grounding_fault" and "sentences" in props:
        context=json.loads(payload["contents"][0]["parts"][0]["text"])
        result={"status":"answer","species":context["species"],"sentences":["It grows along riverbanks."],"used_chunk_ids":[c["chunk_id"] for c in context["evidence"]]}
        return httpx.Response(200,json={"candidates":[{"finishReason":"STOP","content":{"parts":[{"text":json.dumps(result)}]}}]})
    return httpx.Response(503 if judge else 429,json={"error":{"message":"Controlled outage"}})
def client_factory(**kw):
    if mode in {"controlled","grounding_fault"}:kw["transport"]=httpx.MockTransport(failure_transport)
    return original_client(event_hooks={"request":[before],"response":[after]},**kw)
httpx.AsyncClient=client_factory
a=create_app();a.dependency_overrides[get_settings]=lambda:s
a.add_middleware(CORSMiddleware,allow_origin_regex=r"http://127\\.0\\.0\\.1:\\d+",allow_methods=["POST"],allow_headers=["content-type"])
@a.post("/test/mode")
def control(body:dict):
    global mode
    mode=body["mode"];assert mode in {"live","controlled","grounding_fault","off"}
    s.assistant_judge_enabled=s.assistant_generation_enabled=mode!="off"
    s.assistant_generation_key=original_key if mode!="off" else None
    return {"mode":mode}
@a.get("/test/status")
def status():return {"records":records,"live_calls":sum(x["mode"]=="live" for x in records),"controlled_calls":sum(x["mode"] in {"controlled","grounding_fault"} for x in records)}
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
const output=resolve(root,process.env.EPIC8_LIVE_UI_OUTPUT??'.local-data/epic8-live-20261006/live-ui.json')
// Preserve failed attempts; never overwrite an existing live record.
try { await readFile(output); throw new Error('Recorded live browser run already exists') } catch (error) { if (error.code !== 'ENOENT') { backend.kill('SIGTERM'); throw error } }
const uiErrors=resume?.ui_errors??[], requests=resume?Array.from({length:resume.api_posts},()=>null):[], apiRecords=resume?.api_records??[], depths=resume?.depths??[]
let completed = resume?.browser_groups??0
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
      builder.onResolve({filter:/^virtual:reference-image-versions$/}, () => ({path:'versions',namespace:'reference-images'}))
      builder.onLoad({filter:/.*/,namespace:'reference-images'}, async () => ({contents:await imagePlugin.load('\0virtual:reference-image-versions'),loader:'js'}))
    }}],
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
  page.on('pageerror', error => uiErrors.push(error.message))
  page.on('request', request => { if (request.url().endsWith('/ask') && request.method() === 'POST') requests.push(request.postDataJSON()) })
  const open = async (query = '') => {
    await page.goto(uiBase + query)
    assert.equal(await page.locator('.scan-result__disclosure').count(), 1)
    await page.getByRole('button', { name: 'Ask about this plant', exact: true }).click()
  }
  let lastRequest = 0
  const pace = async () => { const wait = 24_000 - (Date.now() - lastRequest); if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait)); lastRequest = Date.now() }
  const ask = async question => {
    await pace()
    await page.getByLabel('Your question').fill(question)
    const response = page.waitForResponse(r => r.url().endsWith('/ask') && r.request().method() === 'POST')
    await page.getByRole('button', { name: 'Ask question', exact: true }).click()
    const real = await response
    assert.equal(real.status(), 200)
    const body = await real.json()
    await page.locator('.plant-assistant__answer').waitFor()
    assert.equal(await page.locator('.plant-assistant__answer').innerText(), body.answer)
    apiRecords.push({request:requests.at(-1),response:body})
    return body
  }

  let next,body
  if(!resume){
  await open()
  await pace()
  next = page.waitForResponse(r => r.url().endsWith('/ask'))
  await page.getByRole('button',{name:'Where does it grow?',exact:true}).click()
  body=await (await next).json(); await page.locator('.plant-assistant__answer').waitFor()
  assert.equal(body.status,'answer'); apiRecords.push({request:requests.at(-1),response:body})
  assert.equal(requests.at(-1).speciesId,'mikania-micrantha'); assert.equal(requests.at(-1).classifierConfidence,.95)
  passed('actual scan result and suggested question show real Gemini answer with correct context')
  await open('?species=acacia-auriculiformis')
  body=await ask('Are its pods twisted?');assert.equal(body.status,'answer')
  assert(body.sources.every(s=>s.chunkId.startsWith('CAT-acacia-auriculiformis-')))
  passed('actual semantic judge and generation show same-species supporting citations')
  await open()
  body=await ask('Explain the scan result');assert.equal(body.status,'answer')
  const beforeRepeat=requests.length
  await page.getByLabel('Your question').fill('  EXPLAIN THE SCAN RESULT  ')
  await page.getByRole('button',{name:'Ask question',exact:true}).click()
  await page.locator('.plant-assistant__repeat').waitFor();assert.equal(requests.length,beforeRepeat)
  for(const [label,depth] of [['Simpler explanation','simpler'],['Standard explanation','standard'],['More detail','detailed']]){
    await pace();next=page.waitForResponse(r=>r.url().endsWith('/ask'))
    await page.getByRole('button',{name:label,exact:true}).click()
    body=await (await next).json();await page.locator('.plant-assistant__answer').waitFor()
    assert.equal(body.status,'answer');assert.equal(requests.at(-1).depth,depth)
    apiRecords.push({request:requests.at(-1),response:body});depths.push({depth,answer:body.answer})
  }
  assert.equal(new Set(depths.map(x=>x.answer)).size,3)
  assert(depths[0].answer.split(/\s+/).length<depths[1].answer.split(/\s+/).length)
  assert(depths[1].answer.split(/\s+/).length<depths[2].answer.split(/\s+/).length)
  passed('answered trim/case repeat offers real three-depth generated responses with increasing detail')
  const links=await page.locator('.plant-assistant__response ul a').evaluateAll(a=>a.map(x=>x.href))
  assert.equal(new Set(links).size,links.length);assert(links.every(url=>body.sources.some(s=>s.sourceUrl===url)||url.includes('creativecommons')))
  passed('real generated answer uses stored source links without duplicate URLs')
  body=await ask('When does it flower?');assert.equal(body.status,'insufficient_evidence')
  assert(body.coveredTopics.includes('identification'));assert(await page.locator('.plant-assistant__coverage').isVisible())
  passed('unsupported timing shows related sources and actual covered topics without generation')
  for(const q of ['?species=unknown','?outcome=other_plant','?outcome=uncertain']){
    await open(q);assert.equal(await page.getByLabel('Your question').count(),0)
  }
  await open();await page.evaluate(()=>window.setEpic8Result({confidence:.1}))
  await page.getByRole('button',{name:'Ask about this plant',exact:true}).click()
  body=await ask('Where does it grow?');assert.equal(body.status,'unsupported_scan');assert.equal(body.sources.length,0)
  passed('Unknown/Other/uncertain/low-confidence and changed context never guess species')
  await open('?species=asclepias-curassavica')
  body=await ask('Is it safe to touch?');assert.equal(body.status,'fallback');assert.equal(body.answer,'Milky sap can irritate skin.')
  passed('documented hazard is backend-controlled with source and permission boundary')
  await open()
  body=await ask('Can I leave stem pieces on damp ground?')
  const protectedAnswer=body.answer,boundary=body.safetyBoundary
  for(const label of ['Simpler explanation','Standard explanation','More detail']){
    next=page.waitForResponse(r=>r.url().endsWith('/ask'))
    await page.getByRole('button',{name:label,exact:true}).click()
    body=await (await next).json();await page.locator('.plant-assistant__answer').waitFor()
    apiRecords.push({request:requests.at(-1),response:body})
    assert.equal(body.answer,protectedAnswer);assert.equal(body.safetyBoundary,boundary)
  }
  passed('complete safety paragraph and boundary unchanged at all depths with zero model safety paraphrase')
  const source=body.sources.find(s=>s.sourceUrl.includes('business.qld.gov.au'))
  const popupPromise=page.waitForEvent('popup')
  await page.locator(`.plant-assistant__response ul a[href="${source.sourceUrl}"]`).click()
  const popup=await popupPromise
  try{await popup.waitForURL(source.sourceUrl,{waitUntil:'domcontentloaded',timeout:15_000});assert.equal(popup.url(),source.sourceUrl)}finally{await popup.close()}
  passed('stored government source link opens its actual page')
  for(const width of [375,1280]){
    await page.setViewportSize({width,height:900})
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
    if(process.env.EPIC8_UI_SCREENSHOT_DIR){await mkdir(process.env.EPIC8_UI_SCREENSHOT_DIR,{recursive:true});await page.locator('.plant-assistant').screenshot({path:resolve(process.env.EPIC8_UI_SCREENSHOT_DIR,`live-assistant-${width}.png`)})}
  }
  passed('mobile375/desktop1280 real styling has no horizontal overflow')
  await fetch(`${apiBase}/test/mode`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'controlled'})})
  body=await ask('Are its leaves purple?');assert.equal(body.status,'insufficient_evidence')
  body=await ask('Where does it grow?');assert.equal(body.status,'fallback')
  assert.equal(await page.locator('.plant-assistant__response h3').first().innerText(), 'Source information')
  passed('original adapters with controlled503 judge and429 generation show distinct useful UI failure paths')
  }else{await open()}

  await fetch(`${apiBase}/test/mode`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'grounding_fault'})})
  body=await ask('What is its habitat?');assert.equal(body.status,'fallback')
  assert.notEqual(body.answer,'It grows along riverbanks.')
  passed('final grounding503 hides valid generated prose and displays only approved evidence')
  await fetch(`${apiBase}/test/mode`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'off'})})
  await page.route('**/api/v1/plant-assistant/ask',async route=>{await new Promise(resolve=>setTimeout(resolve,350));await route.continue()})
  await page.getByLabel('Your question').fill('When does it flower?')
  next=page.waitForResponse(r=>r.url().endsWith('/ask'))
  await page.getByRole('button',{name:'Ask question',exact:true}).click()
  assert(await page.getByRole('button',{name:'Preparing your answer…',exact:true}).isDisabled())
  assert.equal(await page.locator('.plant-assistant__answer').count(),0)
  await next;await page.locator('.plant-assistant__answer').waitFor();await page.unroute('**/api/v1/plant-assistant/ask')
  await page.route('**/api/v1/plant-assistant/ask',route=>route.abort('failed'))
  await page.getByLabel('Your question').fill('How does it spread?');await page.getByRole('button',{name:'Ask question',exact:true}).click()
  await page.getByRole('alert').waitFor();assert.equal(await page.locator('.plant-assistant__answer').count(),0)
  await page.unroute('**/api/v1/plant-assistant/ask')
  assert.deepEqual(uiErrors,[])
  passed('loading, readable network error and no stale answer or browser exception')
  const provider=await (await fetch(`${apiBase}/test/status`)).json()
  assert.equal(provider.live_calls,13);assert.equal(provider.controlled_calls,4)
  assert(provider.records.filter(x=>x.mode==='live').every(x=>x.http_status===200&&x.model==='gemini-3.5-flash-lite'))
  await mkdir(resolve(root,'.local-data/epic8-live-20261006'),{recursive:true})
  await writeFile(output,JSON.stringify({resumed_controlled_only:Boolean(resume),resume_from:process.env.EPIC8_LIVE_UI_RESUME_FROM??null,browser_groups:completed,api_posts:requests.length,api_records:apiRecords,depths,provider,ui_errors:uiErrors},null,2))
  console.log(`RESULT ${completed} live browser groups PASS; ${requests.length} browser POST attempts; ${provider.live_calls} live Gemini calls; ${provider.controlled_calls} controlled HTTP calls`)
} catch (error) {
  const provider=await fetch(`${apiBase}/test/status`).then(r=>r.json()).catch(()=>null)
  await mkdir(resolve(root,'.local-data/epic8-live-20261006'),{recursive:true})
  await writeFile(output,JSON.stringify({status:'FAILED',error:error.message,browser_groups:completed,api_posts:requests.length,api_records:apiRecords,depths,provider,ui_errors:uiErrors},null,2))
  throw error
} finally {
  await browser?.close()
  if(server)await new Promise(resolve=>server.close(resolve))
  const exited=new Promise(resolve=>backend.once('exit',resolve))
  if(backend.exitCode===null){backend.kill('SIGTERM');await exited}
  console.log('Local live browser/server/backend stopped')
}
