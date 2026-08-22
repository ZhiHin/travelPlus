import { describe, expect, it } from 'vitest'
import {
  GEOCODER_ATTRIBUTION,
  MAP_ATTRIBUTION,
  WEATHER_ATTRIBUTION,
  attributionFor,
  feedAttribution,
} from './attribution.js'

/**
 * Attribution is a licence condition. These tests exist so a redesign that
 * removes a line fails the build rather than quietly breaching a licence.
 */

describe('map attribution', () => {
  // The OSMF tile policy requires this specific text clearly on the map.
  it('always includes the OpenStreetMap contributors line', () => {
    expect(MAP_ATTRIBUTION.map((a) => a.text)).toContain('© OpenStreetMap contributors')
  })

  it('includes OpenMapTiles, as OpenFreeMap requests', () => {
    expect(MAP_ATTRIBUTION.some((a) => a.text.includes('OpenMapTiles'))).toBe(true)
  })

  it('links the OSM copyright page', () => {
    const osm = MAP_ATTRIBUTION.find((a) => a.text.includes('OpenStreetMap contributors'))
    expect(osm?.href).toBe('https://www.openstreetmap.org/copyright')
  })

  // Every entry explains itself, so a reviewer wondering "can this go?" has the
  // answer next to it rather than in a document they will not open.
  it('records why each line is required', () => {
    for (const entry of MAP_ATTRIBUTION) {
      expect(entry.required.length).toBeGreaterThan(10)
    }
  })

  it('is frozen, so it cannot be mutated at runtime', () => {
    expect(Object.isFrozen(MAP_ATTRIBUTION)).toBe(true)
    expect(() => {
      ;(MAP_ATTRIBUTION as unknown as unknown[]).push({ text: 'x', required: 'y' })
    }).toThrow()
  })
})

describe('attributionFor', () => {
  // A map with no attribution is a licence breach, so this must never be empty.
  it('never returns an empty list when a map is shown', () => {
    expect(attributionFor({ hasMap: true }).length).toBeGreaterThan(0)
  })

  it('adds geocoder attribution only when results are shown', () => {
    const without = attributionFor({ hasMap: true })
    const with_ = attributionFor({ hasMap: true, hasGeocodedResults: true })
    expect(with_.length).toBeGreaterThan(without.length)
    expect(with_.some((a) => a.text.includes('Nominatim'))).toBe(true)
  })

  it('adds weather attribution only when weather is shown', () => {
    expect(attributionFor({ hasMap: true, hasWeather: true })).toEqual(
      expect.arrayContaining([expect.objectContaining({ text: WEATHER_ATTRIBUTION[0]!.text })]),
    )
    expect(attributionFor({ hasMap: true }).some((a) => a.text.includes('Open-Meteo'))).toBe(false)
  })

  it('returns nothing for a surface with no provider data', () => {
    expect(attributionFor({ hasMap: false })).toEqual([])
  })
})

describe('transit feed attribution', () => {
  // Derived from stored metadata rather than a constant: the text must match the
  // feed actually backing the route, and a constant drifts the moment a second
  // operator is added.
  it('renders from the feed record', () => {
    const entry = feedAttribution({ agency: 'Prasarana', attribution: 'Data from data.gov.my' })
    expect(entry.text).toBe('Data from data.gov.my')
    expect(entry.required).toContain('Prasarana')
  })

  it('includes one entry per feed backing the surface', () => {
    const entries = attributionFor({
      hasMap: true,
      feeds: [
        { agency: 'Prasarana', attribution: 'Data from data.gov.my' },
        { agency: 'KTMB', attribution: 'Data from data.gov.my' },
      ],
    })
    expect(entries.filter((e) => e.required.includes('Prasarana'))).toHaveLength(1)
    expect(entries.filter((e) => e.required.includes('KTMB'))).toHaveLength(1)
  })
})

describe('the geocoder line', () => {
  it('names the source, as the Nominatim policy requires', () => {
    expect(GEOCODER_ATTRIBUTION[0]!.text.toLowerCase()).toContain('openstreetmap')
  })
})
