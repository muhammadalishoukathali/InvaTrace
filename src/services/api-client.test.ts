import { describe, expect, it } from 'vitest'
import { apiUrl } from './api-client'

describe('apiUrl', () => {
  it('resolves a relative API path for Node/MSW without environment setup', () => {
    expect(apiUrl('/api/v1/catalogue')).toBe('http://localhost/api/v1/catalogue')
  })

  it('always returns a fetch-compatible absolute URL', () => {
    const resolved = apiUrl('/api/v1/catalogue')
    expect(new URL(resolved).origin).toBe('http://localhost')
    expect(new URL(resolved).pathname).toBe('/api/v1/catalogue')
  })
})
