import { describe, expect, it } from 'vitest'
import { parseLocalDateTime, toLocalDateTimeValue } from './date-time'

describe('local date and time input', () => {
  it('preserves the selected local minute when converting to the API time', () => {
    const date = parseLocalDateTime('2030-01-31T23:45')!
    expect(toLocalDateTimeValue(new Date(date.toISOString()))).toBe('2030-01-31T23:45')
  })

  it('accepts leap days in leap years', () => {
    expect(toLocalDateTimeValue(parseLocalDateTime('2028-02-29T08:00')!)).toBe('2028-02-29T08:00')
  })

  it.each(['', '2030-01', '2030-02-29T08:00', '2030-04-31T08:00', '2030-00-01T08:00',
    '2030-13-01T08:00', '2030-01-00T08:00', '2030-01-01T24:00', '2030-01-01T08:60',
    '0030-01-01T08:00', '2030-01-01T08:00Z', '01/02/2030 08:00'])('rejects invalid or ambiguous input: %s', value => {
    expect(parseLocalDateTime(value)).toBeNull()
  })
})
