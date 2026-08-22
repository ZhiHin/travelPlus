/**
 * Provider attribution.
 *
 * Attribution is a licence condition, not a courtesy. OpenFreeMap asks for
 * "OpenFreeMap © OpenMapTiles Data from OpenStreetMap"; the OSM tile policy
 * requires "© OpenStreetMap contributors" to be clearly visible and forbids
 * hiding it behind a toggle. Getting it wrong is a licence breach, not a
 * cosmetic slip.
 *
 * So the strings live here, in the domain, with the map component unable to
 * render without them — rather than as markup in a component someone can
 * delete during a redesign.
 */

export interface AttributionEntry {
  /** Text that must appear. */
  readonly text: string
  /** Optional link, where the licence names one. */
  readonly href?: string
  /** Why this is required, for the reviewer who wonders if it can go. */
  readonly required: string
}

/**
 * Map tile attribution, verified 2026-08-19 against OpenFreeMap and the OSM
 * Foundation tile usage policy.
 */
export const MAP_ATTRIBUTION: readonly AttributionEntry[] = Object.freeze([
  Object.freeze({
    text: '© OpenStreetMap contributors',
    href: 'https://www.openstreetmap.org/copyright',
    required: 'ODbL. The OSMF tile policy requires this clearly on the map, not behind a toggle.',
  }),
  Object.freeze({
    text: '© OpenMapTiles',
    href: 'https://openmaptiles.org/',
    required: 'Requested by OpenFreeMap as the schema author.',
  }),
  Object.freeze({
    text: 'OpenFreeMap',
    href: 'https://openfreemap.org/',
    required: 'Optional per OpenFreeMap, included because they host the tiles at no cost.',
  }),
])

export const GEOCODER_ATTRIBUTION: readonly AttributionEntry[] = Object.freeze([
  Object.freeze({
    text: 'Search by Nominatim / OpenStreetMap',
    href: 'https://openstreetmap.org/copyright',
    required: 'ODbL, and the Nominatim policy requires attribution suitable to the medium.',
  }),
])

export const WEATHER_ATTRIBUTION: readonly AttributionEntry[] = Object.freeze([
  Object.freeze({
    text: 'Weather by Open-Meteo',
    href: 'https://open-meteo.com/',
    required: 'CC-BY 4.0 requires attribution.',
  }),
])

/**
 * Attribution for a transit feed, built from stored metadata.
 *
 * Deliberately derived rather than hard-coded: the text must match the feed
 * actually backing the route shown, and a constant would drift the moment a
 * second operator is added.
 */
export function feedAttribution(feed: {
  readonly agency: string
  readonly attribution: string
}): AttributionEntry {
  return {
    text: feed.attribution,
    required: `Licence condition of the ${feed.agency} feed.`,
  }
}

/**
 * Everything that must be visible on a surface.
 *
 * Returns a non-empty list whenever a map is shown, so a component that renders
 * `[]` is a bug the type system cannot catch but a test can.
 */
export function attributionFor(surface: {
  readonly hasMap: boolean
  readonly hasGeocodedResults?: boolean
  readonly hasWeather?: boolean
  readonly feeds?: readonly { readonly agency: string; readonly attribution: string }[]
}): AttributionEntry[] {
  const entries: AttributionEntry[] = []
  if (surface.hasMap) entries.push(...MAP_ATTRIBUTION)
  if (surface.hasGeocodedResults) entries.push(...GEOCODER_ATTRIBUTION)
  if (surface.hasWeather) entries.push(...WEATHER_ATTRIBUTION)
  for (const f of surface.feeds ?? []) entries.push(feedAttribution(f))
  return entries
}
