import { describe, expect, it } from 'vitest'
import { localDateTime } from './otp.js'

describe('localDateTime', () => {
  // 2026-08-24T01:00:00Z is 09:00 on the same day in Kuala Lumpur (UTC+8).
  const instant = new Date('2026-08-24T01:00:00Z')

  it('converts to the router zone, not UTC', () => {
    expect(localDateTime(instant, 'Asia/Kuala_Lumpur')).toEqual({
      date: '2026-08-24',
      time: '09:00:00',
    })
  })

  it('crosses the date line when the zone does', () => {
    // 23:30 in KL on the 24th is 15:30Z; in Los Angeles it is still the 24th at 08:30.
    const late = new Date('2026-08-24T15:30:00Z')
    expect(localDateTime(late, 'Asia/Kuala_Lumpur')).toEqual({
      date: '2026-08-24',
      time: '23:30:00',
    })
    expect(localDateTime(late, 'Pacific/Auckland')).toEqual({
      date: '2026-08-25',
      time: '03:30:00',
    })
  })

  it('keeps seconds', () => {
    expect(localDateTime(new Date('2026-08-24T01:02:03Z'), 'Asia/Kuala_Lumpur').time).toBe(
      '09:02:03',
    )
  })

  it('uses 24-hour time with no midnight-as-24 quirk', () => {
    expect(localDateTime(new Date('2026-08-23T16:00:00Z'), 'Asia/Kuala_Lumpur')).toEqual({
      date: '2026-08-24',
      time: '00:00:00',
    })
  })
})
