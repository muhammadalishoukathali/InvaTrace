import { describe, expect, it } from 'vitest'
import { welcomeRedirect } from './welcome-entry'

describe('root URL entry rule', () => {
  it('shows the welcome page to visitors without an identity', () => {
    expect(welcomeRedirect('initializing', false)).toBeNull()
    expect(welcomeRedirect('needs-access', false)).toBeNull()
    expect(welcomeRedirect('revoked', false)).toBeNull()
    expect(welcomeRedirect('storage-error', false)).toBeNull()
  })

  it('sends an existing identity to the map', () => {
    for (const status of ['syncing', 'ready', 'offline', 'error']) {
      expect(welcomeRedirect(status, true)).toBe('/map')
    }
  })

  it('resumes an unfinished recovery kit', () => {
    expect(welcomeRedirect('recovery', true)).toBe('/private-access/recovery')
  })

  it('does not treat a storage failure as a usable identity', () => {
    expect(welcomeRedirect('storage-error', true)).toBeNull()
  })
})
