import { describe, expect, it } from 'vitest'
import { backTarget, originState } from './event-navigation'

describe('event back navigation', () => {
  it('returns to the screen the event was opened from, filters included', () => {
    expect(backTarget(originState('/events', '?range=week&view=map'), '/events')).toEqual({ to: '/events?range=week&view=map', children: 'Back to events' })
    expect(backTarget(originState('/events/mine'), '/events')).toEqual({ to: '/events/mine', children: 'Back to your hosted events' })
    expect(backTarget(originState('/places/abc'), '/events').children).toBe('Back to place')
    expect(backTarget(originState('/events/e1/summary'), '/events').children).toBe('Back to summary')
  })

  it('falls back when there is no origin or it is not an app path', () => {
    expect(backTarget(null, '/events')).toEqual({ to: '/events', children: 'Back to events' })
    expect(backTarget({ from: '//evil.example' }, '/events').to).toBe('/events')
    expect(backTarget({ from: 'https://evil.example' }, '/events').to).toBe('/events')
  })
})
