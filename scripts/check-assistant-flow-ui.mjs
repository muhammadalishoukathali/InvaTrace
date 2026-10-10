/** Offline shared-panel browser acceptance. No real API or provider is contacted. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { build } from 'esbuild'
import { chromium } from '@playwright/test'

const root = fileURLToPath(new URL('..', import.meta.url))
const output = join(root, 'work', 'flow-ui')
await mkdir(output, { recursive: true })
await build({
  stdin: { contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import './src/styles/global.css';
    import {PlantAssistantPanel} from './src/features/scan/PlantAssistantPanel';
    const species={speciesId:'mikania-micrantha',scientificName:'Mikania micrantha'};
    const entry=new URLSearchParams(location.search).get('entry');
    const context=entry==='map'?{mapContext:{...species,sightingId:'00000000-0000-0000-0000-000000000101'}}:
      entry==='scan'?{result:{...species,outcome:'target',confidence:.95,modelVersion:'mock',reportable:true}}:{guideContext:species};
    createRoot(document.getElementById('root')).render(<PlantAssistantPanel {...context} initiallyOpen/>);
  `, resolveDir: root, loader: 'tsx' },
  outfile: join(output, 'app.js'), bundle: true, format: 'esm', jsx: 'automatic',
  alias: { '@': join(root, 'src'), '@shared': join(root, 'shared') }, loader: { '.woff2': 'dataurl', '.woff': 'dataurl' },
  define: { 'import.meta.env': JSON.stringify({ DEV: false, VITE_API_BASE_URL: '' }) },
})
const server = createServer(async (req, res) => {
  if (req.url.startsWith('/app.js') || req.url.startsWith('/app.css')) {
    res.setHeader('Content-Type', req.url.startsWith('/app.js') ? 'text/javascript' : 'text/css')
    res.end(await readFile(join(output, req.url.slice(1))))
  } else {
    res.setHeader('Content-Type', 'text/html')
    res.end('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><style>body{margin:0;padding:16px;background:#f6f8f5;color:#213c2c;font:16px system-ui}#root{max-width:800px;margin:auto}*{box-sizing:border-box}</style><div id="root"></div><script type="module" src="/app.js"></script></html>')
  }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
let browser
try {
  browser = await chromium.launch({ headless: true, ...(process.env.EPIC8_BROWSER_CHANNEL ? { channel: process.env.EPIC8_BROWSER_CHANNEL } : {}) })
  for (const width of [1280, 390]) {
    for (const entry of ['scan', 'guide', 'map']) {
      const page = await browser.newPage({ viewport: { width, height: 900 } })
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('**/api/v1/plant-assistant/**', async route => {
        const body = route.request().postDataJSON()
        assert.equal(body.sectionAware, true)
        assert.ok(route.request().url().endsWith(entry === 'scan' ? '/ask' : `/${entry}/ask`))
        const source = {chunkId:'reviewed-habitat',sourceName:'Reviewed publisher',sourceUrl:'https://reviewed.example.org/habitat',jurisdiction:'global',attribution:'Publisher credit'}
        const warning = "This information was generated using AI knowledge and has not been verified against InvaTrace's reviewed sources. It may contain inaccuracies."
        const social = body.question === 'hello'
        const general = body.question === 'What is a rhizome?'
        const failed = body.question.includes('unavailable')
        const sections = social ? [{kind:'conversation',title:'Plant conversation',answer:'Hello! What would you like to learn about plants?',depth:'standard',sources:[]}]
          : general ? [{kind:'ai',title:'Additional AI-generated information',answer:'A rhizome is an underground stem.',depth:body.depth,sources:[],warning}]
          : [{kind:'grounded',title:'From reviewed sources',answer:'It grows along riverbanks.',depth:body.depth,sources:[source]},
            failed ? {kind:'unavailable',title:'Additional information unavailable',answer:'The additional information did not pass validation.',depth:'standard',sources:[]}
            : {kind:'ai',title:'Additional AI-generated information',answer:'A rhizome is an underground stem.',depth:body.depth==='detailed'?'standard':body.depth,sources:[],warning}]
        await route.fulfill({json:{status:'answer',answerability:social?'insufficient_evidence':'answerable',answer:'Compatibility summary',answerMode:general?'general_knowledge':'grounded',intent:social?'greeting':'botanical',safetyBoundary:'Follow the existing safety and site-permission checks.',sources:general||social?[]:[source],sections,mixedDepthNotice:body.depth==='detailed'?'Reviewed content uses Detailed; additional AI-generated information uses Standard.':null}})
      })
      await page.goto(`${base}/?entry=${entry}`)
      const submit = async question => {
        await page.getByLabel('Your question', {exact:true}).fill(question)
        await page.getByRole('button', {name:'Ask question',exact:true}).click()
        await page.locator('.plant-assistant__response').waitFor()
        await page.getByRole('button', {name:'Ask question',exact:true}).waitFor({state:'visible'})
      }
      await submit('Where does it grow and what is a rhizome?')
      const latest = page.locator('.plant-assistant__response')
      await latest.getByRole('region', {name:'From reviewed sources'}).getByRole('link', {name:'Reviewed publisher'}).waitFor()
      assert.equal(await latest.getByRole('region', {name:'Additional AI-generated information'}).locator('a').count(), 0)
      await latest.getByRole('button', {name:'More detail',exact:true}).click()
      await latest.getByText('Reviewed content uses Detailed; additional AI-generated information uses Standard.', {exact:true}).waitFor()
      assert.equal(await latest.locator('[data-section-kind="ai"]').getAttribute('data-section-depth'), 'standard')
      assert.equal(await latest.locator('[data-section-kind="grounded"]').getAttribute('data-section-depth'), 'detailed')
      await latest.evaluate(element => element.scrollIntoView({block:'start'}))
      await page.screenshot({path:join(output, `${entry}-${width}.png`),fullPage:true})
      await submit('What is a rhizome?')
      await latest.getByText('A rhizome is an underground stem.', {exact:true}).waitFor()
      assert.equal(await latest.getByRole('button', {name:'More detail',exact:true}).count(), 0)
      await submit('Where does it grow and unavailable information?')
      await latest.getByText('The additional information did not pass validation.', {exact:true}).waitFor()
      assert.equal(await latest.getByRole('link', {name:'Reviewed publisher'}).count(), 1)
      await submit('hello')
      await latest.getByText('Hello! What would you like to learn about plants?', {exact:true}).waitFor()
      assert.equal(await latest.locator('a').count(), 0)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'horizontal overflow')
      assert.deepEqual(errors, [])
      await page.close()
      console.log(`PASS ${entry} at ${width}px: mixed, depth, AI-only, unavailable, greeting, no overflow`)
    }
  }
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
