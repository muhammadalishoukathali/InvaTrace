import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'
import { handlers, resolveSightingSpecies } from './handlers'
import { modelSpeciesCatalogue } from '@/data/model-species-catalogue'
import { developmentIdentifyResultForHash } from '@/features/scan/plant-model-adapter'
import { MAP_FILTER_SPECIES } from '@/features/map/MapFilters'
import { approvedSpeciesDataset } from '@shared/catalogue'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, String(value)) }
}

const server = setupServer(...handlers)
const installationToken = (character: string) => character.repeat(43)

async function start(token = installationToken('A')) {
  const response = await fetch('http://localhost/api/v1/profiles/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ installationToken: token, role: 'Admin', trustLevel: 'Steward' }),
  })
  return { response, payload: await response.json() as {
    accessToken: string
    profile: { id: string; role: string; trustLevel: string }
    recoveryCodes: string[]
  } }
}

beforeAll(() => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: new MemoryStorage() })
  server.listen({ onUnhandledRequest: 'error' })
})
afterAll(() => server.close())
beforeEach(() => localStorage.clear())

describe('reported sighting species labels', () => {
  it('exposes exactly the closed 32-species business catalogue', async () => {
    const response = await fetch('http://localhost/api/v1/species')
    const body = await response.json() as {
      items: Array<{ id: string; isInvasive: boolean; malaysiaStatus: string }>
    }
    expect(response.status).toBe(200)
    expect(body.items).toHaveLength(32)
    expect(body.items.every((item) => item.isInvasive && item.malaysiaStatus === 'invasive')).toBe(true)
    expect(new Set(body.items.map((item) => item.id))).toEqual(new Set(
      approvedSpeciesDataset.records.map((item) => item.species_id),
    ))
  })

  it('keeps the 32-class development model operational and treats every class as approved', () => {
    const results = modelSpeciesCatalogue.classes.map((_, index) => developmentIdentifyResultForHash(index))
    expect(results.map((result) => result.speciesId)).toEqual(
      modelSpeciesCatalogue.classes.map((item) => item.machine_label.replaceAll('_', '-')),
    )
    expect(results.filter((result) => result.outcome === 'target')).toHaveLength(32)
    expect(results.filter((result) => result.outcome === 'other_plant')).toHaveLength(0)
    expect(developmentIdentifyResultForHash(modelSpeciesCatalogue.classes.length).outcome).toBe('uncertain')
  })

  it('derives public map filters from the approved catalogue', () => {
    expect(MAP_FILTER_SPECIES).toHaveLength(32)
    expect(MAP_FILTER_SPECIES.map((item) => item.id)).toEqual(
      approvedSpeciesDataset.records.map((item) => item.species_id),
    )
    expect(MAP_FILTER_SPECIES.some((item) => item.id === 'lantana-camara')).toBe(false)
  })

  it('keeps the model identification for Mimosa diplotricha on the map', () => {
    expect(resolveSightingSpecies('mimosa-diplotricha')).toEqual({
      speciesName: 'Giant sensitive plant',
      latinName: 'Mimosa diplotricha',
      risk: 'high',
    })
  })

  it('uses the unavailable fallback only for IDs outside the reviewed catalogue', () => {
    expect(resolveSightingSpecies('not-a-reviewed-species')).toMatchObject({
      speciesName: 'Reported plant',
      latinName: 'Identification unavailable',
    })
  })

  it('has exact display coverage for every approved business catalogue entry', () => {
    for (const species of approvedSpeciesDataset.records) {
      const speciesId = species.species_id
      expect(resolveSightingSpecies(speciesId)).toMatchObject({
        speciesName: species.common_names[0],
        latinName: species.scientific_name,
      })
    }
  })

  it('returns only approved species details and never fabricates missing images', async () => {
    for (const species of approvedSpeciesDataset.records) {
      const speciesId = species.species_id
      const response = await fetch(`http://localhost/api/v1/species/${speciesId}`)
      const detail = await response.json() as {
        latinName: string
        isInvasive: boolean
        reportEligible: boolean
        referenceImageUrl: string | null
      }
      expect(response.status).toBe(200)
      expect(detail.latinName).toBe(species.scientific_name)
      expect(detail.isInvasive).toBe(true)
      expect(detail.reportEligible).toBe(true)
      if (detail.referenceImageUrl) expect(detail.referenceImageUrl).toMatch(/^\/reference-images\/.+\.jpg$/)
    }
    expect((await fetch('http://localhost/api/v1/species/lantana-camara')).status).toBe(404)
  })
})

describe('private access mock contract', () => {
  it('creates explicit Detector/New access, returns three 128-bit reusable codes, and persists only hashes', async () => {
    const { response, payload } = await start()

    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(payload.profile).toMatchObject({ role: 'Detector', trustLevel: 'New' })
    // 6-digit numeric public profile id, matching the FastAPI backend.
    expect(payload.profile.id).toMatch(/^\d{6}$/)
    expect(payload.recoveryCodes).toHaveLength(3)
    for (const code of payload.recoveryCodes) expect(code.replace(/-/g, '')).toHaveLength(26)

    const persisted = localStorage.getItem('invatrace-mock-server-v2') ?? ''
    expect(persisted).not.toContain(installationToken('A'))
    for (const code of payload.recoveryCodes) expect(persisted).not.toContain(code)
    expect(persisted).not.toContain(payload.accessToken)
  })

  it('bootstrap restores known installations, never creates unknown ones, and tracks setup acknowledgement', async () => {
    const { payload } = await start()
    const unknown = await fetch('http://localhost/api/v1/profiles/bootstrap', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installationToken: installationToken('B') }),
    })
    expect(unknown.status).toBe(404)
    expect(await unknown.json()).toMatchObject({ code: 'installation_not_found' })

    const bootstrap = await fetch('http://localhost/api/v1/profiles/bootstrap', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installationToken: installationToken('A') }),
    })
    expect(await bootstrap.json()).toMatchObject({
      profile: { id: payload.profile.id },
      recoverySetupRequired: true,
    })

    await fetch('http://localhost/api/v1/profiles/me/recovery-setup/acknowledge', {
      method: 'POST', headers: { Authorization: `Bearer ${payload.accessToken}` },
    })
    const acknowledged = await fetch('http://localhost/api/v1/profiles/bootstrap', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installationToken: installationToken('A') }),
    })
    expect(await acknowledged.json()).toMatchObject({ recoverySetupRequired: false })
  })

  it('restores additional installations with reusable codes and returns indistinguishable failures', async () => {
    const { payload } = await start()
    const restore = (token: string, profileId = payload.profile.id, code = payload.recoveryCodes[0]) =>
      fetch('http://localhost/api/v1/profiles/restore', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId, recoveryCode: code, installationToken: token }),
      })

    // Reusable codes accept back-to-back restores from different devices.
    const first = await restore(installationToken('B'))
    const second = await restore(installationToken('C'))
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)

    // A profile id that doesn't exist and a code that doesn't belong to
    // the profile must return the same 400 payload, so callers can't
    // distinguish "no such profile" from "wrong code".
    const invalidId = await restore(installationToken('D'), '000000', payload.recoveryCodes[1])
    const wrongCode = await restore(installationToken('E'), payload.profile.id, 'ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZ')
    expect(invalidId.status).toBe(400)
    expect(wrongCode.status).toBe(400)
    expect(await invalidId.text()).toBe(await wrongCode.text())

    const restored = await first.json() as { accessToken: string }
    const overview = await fetch('http://localhost/api/v1/profiles/me/access', {
      headers: { Authorization: `Bearer ${restored.accessToken}` },
    })
    const access = await overview.json() as { installations: unknown[]; recoveryCodeCount: number }
    // original + two successful restores.
    expect(access.installations).toHaveLength(3)
    // Restores do not consume codes; the full reusable batch is still on file.
    expect(access.recoveryCodeCount).toBe(3)
  })

  it('rotation invalidates every earlier code and revocation blocks only the selected installation', async () => {
    const { payload } = await start()
    const restoredResponse = await fetch('http://localhost/api/v1/profiles/restore', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profileId: payload.profile.id,
        recoveryCode: payload.recoveryCodes[0],
        installationToken: installationToken('B'),
      }),
    })
    const restored = await restoredResponse.json() as { accessToken: string }
    const rotatedResponse = await fetch('http://localhost/api/v1/profiles/me/recovery-codes/rotate', {
      method: 'POST', headers: { Authorization: `Bearer ${restored.accessToken}` },
    })
    const rotated = await rotatedResponse.json() as { recoveryCodes: string[] }
    expect(rotated.recoveryCodes).toHaveLength(3)

    const oldCode = await fetch('http://localhost/api/v1/profiles/restore', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profileId: payload.profile.id,
        recoveryCode: payload.recoveryCodes[1],
        installationToken: installationToken('C'),
      }),
    })
    expect(oldCode.status).toBe(400)

    const overview = await fetch('http://localhost/api/v1/profiles/me/access', {
      headers: { Authorization: `Bearer ${restored.accessToken}` },
    }).then((response) => response.json()) as {
      installations: Array<{ id: string; current: boolean }>
    }
    const earlier = overview.installations.find((item) => !item.current)!
    expect((await fetch(`http://localhost/api/v1/profiles/me/installations/${earlier.id}/revoke`, {
      method: 'POST', headers: { Authorization: `Bearer ${restored.accessToken}` },
    })).status).toBe(204)

    const revoked = await fetch('http://localhost/api/v1/profiles/bootstrap', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installationToken: installationToken('A') }),
    })
    const current = await fetch('http://localhost/api/v1/profiles/bootstrap', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installationToken: installationToken('B') }),
    })
    expect(revoked.status).toBe(401)
    expect(current.status).toBe(200)
  })
})

describe('Iteration 2 place and adoption mock contract', () => {
  it('uses owner-scoped adoptions and the selected place geometry', async () => {
    const owner = await start(installationToken('P'))
    const other = await start(installationToken('Q'))
    const authorization = { Authorization: `Bearer ${owner.payload.accessToken}` }
    const places = await (await fetch('http://localhost/api/v1/places')).json() as {
      items: Array<{ placeId: string; displayName: string }>
    }
    const bukit = places.items.find((item) => item.displayName === 'Bukit Kiara')!
    const taman = places.items.find((item) => item.displayName === 'Taman Tugu Trail')!
    const adopt = async (placeId: string) => {
      const response = await fetch('http://localhost/api/v1/adopted-areas', {
        method: 'POST',
        headers: { ...authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify({ placeId }),
      })
      return { response, body: await response.json() as { adoptionId: string } }
    }
    const bukitAdoption = await adopt(bukit.placeId)
    const tamanAdoption = await adopt(taman.placeId)
    expect(bukitAdoption.response.status).toBe(201)
    expect(tamanAdoption.response.status).toBe(201)

    const bukitActivity = await (await fetch(
      `http://localhost/api/v1/adopted-areas/${bukitAdoption.body.adoptionId}/activity`,
      { headers: authorization },
    )).json() as { filteredCount: number; emptyMessage: string | null }
    const tamanActivity = await (await fetch(
      `http://localhost/api/v1/adopted-areas/${tamanAdoption.body.adoptionId}/activity`,
      { headers: authorization },
    )).json() as { filteredCount: number; emptyMessage: string | null }
    expect(bukitActivity.filteredCount).toBeGreaterThan(0)
    expect(tamanActivity).toMatchObject({
      filteredCount: 0,
      emptyMessage: 'No community reports recorded for this area.',
    })

    const filteredActivity = await (await fetch(
      `http://localhost/api/v1/adopted-areas/${bukitAdoption.body.adoptionId}/activity?species_id=no-match`,
      { headers: authorization },
    )).json() as {
      filteredCount: number
      emptyMessage: string | null
      comparison: { recent0To29Days: number }
    }
    expect(filteredActivity.filteredCount).toBe(0)
    expect(filteredActivity.emptyMessage).toBe('No community reports match the current filters.')
    expect(filteredActivity.comparison.recent0To29Days).toBe(0)

    const periodActivity = await (await fetch(
      `http://localhost/api/v1/adopted-areas/${bukitAdoption.body.adoptionId}/activity?period=30`,
      { headers: authorization },
    )).json() as { comparison: { recent0To29Days: number } }
    expect(periodActivity.comparison.recent0To29Days).toBeGreaterThan(0)

    const recentSort = await (await fetch(
      'http://localhost/api/v1/adopted-areas?sort=recent_activity',
      { headers: authorization },
    )).json() as { items: Array<{ name: string; mostRecentReportAt: string | null }> }
    expect(recentSort.items[0].mostRecentReportAt).not.toBeNull()
    expect(recentSort.items.at(-1)?.mostRecentReportAt).toBeNull()

    const otherDelete = await fetch(
      `http://localhost/api/v1/adopted-areas/${bukitAdoption.body.adoptionId}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${other.payload.accessToken}` } },
    )
    expect(otherDelete.status).toBe(404)
    const ownerDelete = await fetch(
      `http://localhost/api/v1/adopted-areas/${bukitAdoption.body.adoptionId}`,
      { method: 'DELETE', headers: authorization },
    )
    expect(ownerDelete.status).toBe(204)
  })
})
