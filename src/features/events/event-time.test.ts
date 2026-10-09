import { describe, expect, it } from 'vitest'
import { earliestStart, eventWindowError, isDaySelectable, isHourSelectable, isStartSelectable, startForDay } from './event-time'

// Fri 9 Oct 2026, 18:52 local
const now = new Date(2026, 9, 9, 18, 52)
const today = new Date(2026, 9, 9)

describe('event time rules', () => {
  it('rounds the earliest start up to the next 15-minute slot', () => {
    expect(earliestStart(now)).toEqual(new Date(2026, 9, 9, 19, 0))
    expect(earliestStart(new Date(2026, 9, 9, 19, 0))).toEqual(new Date(2026, 9, 9, 19, 0))
  })

  it('never offers past days, hours or minutes', () => {
    expect(isDaySelectable(new Date(2026, 9, 8), now)).toBe(false)
    expect(isDaySelectable(today, now)).toBe(true)
    expect(isHourSelectable(today, 18, now)).toBe(false)
    expect(isHourSelectable(today, 19, now)).toBe(true)
    expect(isStartSelectable(new Date(2026, 9, 9, 18, 45), now)).toBe(false)
    // Late at night today has no slots left.
    expect(isDaySelectable(today, new Date(2026, 9, 9, 23, 50))).toBe(false)
  })

  it('caps scheduling at one year ahead', () => {
    expect(isDaySelectable(new Date(2027, 9, 9), now)).toBe(true)
    expect(isDaySelectable(new Date(2027, 9, 10), now)).toBe(false)
  })

  it('keeps the chosen time of day when switching dates, else the earliest open slot', () => {
    expect(startForDay(new Date(2026, 9, 12), now, new Date(2026, 9, 9, 20, 30))).toEqual(new Date(2026, 9, 12, 20, 30))
    expect(startForDay(today, now, new Date(2026, 9, 12, 8, 0))).toEqual(new Date(2026, 9, 9, 19, 0))
    expect(startForDay(new Date(2026, 9, 12), now, null)).toEqual(new Date(2026, 9, 12, 9, 0))
  })

  it('rejects past, inverted, over-long and far-future windows', () => {
    const at = (h: number, m = 0, d = 9) => new Date(2026, 9, d, h, m)
    expect(eventWindowError(at(19), at(21), now)).toBeNull()
    expect(eventWindowError(null, null, now)).toMatch(/Choose a date/)
    expect(eventWindowError(at(21), at(19), now)).toMatch(/after the start/)
    expect(eventWindowError(at(19), at(7, 15, 10), now)).toMatch(/12 hours/)
    expect(eventWindowError(at(18, 0), at(19), now)).toMatch(/already passed/)
    // Within the 15-minute grace a just-picked slot still saves.
    expect(eventWindowError(at(18, 45), at(20), now)).toBeNull()
    // An unchanged start of a running event is not re-judged.
    expect(eventWindowError(at(17), at(20), now, false)).toBeNull()
    expect(eventWindowError(at(16), at(18), now, false)).toMatch(/end time must be in the future/)
    expect(eventWindowError(new Date(2027, 10, 1, 9), new Date(2027, 10, 1, 11), now)).toMatch(/one year/)
  })
})
