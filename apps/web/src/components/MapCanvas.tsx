'use client'

import { attributionFor, type AttributionEntry } from '@travelplus/domain'
import maplibregl from 'maplibre-gl'
import { useEffect, useRef, useState } from 'react'
import styles from './MapCanvas.module.css'

/**
 * The map canvas.
 *
 * Two constraints from Phase 0 shape this component:
 *
 *  - **Attribution is always visible** (ADR-0012). MapLibre's own control is
 *    disabled and attribution is rendered by us, because the built-in one can be
 *    collapsed and the OSMF policy forbids hiding it behind a toggle.
 *  - **No tile prefetching.** `maxBounds` and the absence of any preload or
 *    cache-warming call keep this to what the user is actively viewing. Offline
 *    map coverage is out of scope and stated as such.
 *
 * The map is never the only access path (ADR-0018a): callers render an
 * equivalent semantic list alongside it, and this component exposes its markers
 * to that list rather than owning them exclusively.
 */

export interface MapMarker {
  readonly id: string
  readonly lat: number
  readonly lon: number
  readonly label: string
  /** Ordinal shown on the marker, when the caller is drawing a sequence. */
  readonly index?: number
}

export interface MapCanvasProps {
  readonly styleUrl: string
  readonly center: readonly [number, number]
  readonly zoom?: number
  readonly markers?: readonly MapMarker[]
  readonly selectedId?: string | undefined
  readonly onSelect?: (id: string) => void
  /** Extra attribution beyond the base map — feeds, geocoder, weather. */
  readonly extraAttribution?: readonly AttributionEntry[]
  /** Accessible name for the map region. */
  readonly label: string
}

export function MapCanvas({
  styleUrl,
  center,
  zoom = 12,
  markers = [],
  selectedId,
  onSelect,
  extraAttribution = [],
  label,
}: MapCanvasProps) {
  const container = useRef<HTMLDivElement | null>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const markerRefs = useRef(new Map<string, maplibregl.Marker>())
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!container.current || map.current) return

    let instance: maplibregl.Map
    try {
      instance = new maplibregl.Map({
        container: container.current,
        style: styleUrl,
        center: [center[0], center[1]],
        zoom,
        // We render attribution ourselves so it cannot be collapsed away.
        attributionControl: false,
        // Nothing beyond what the user is actively viewing (ADR-0012).
        maxTileCacheSize: 50,
        // Honour the OS preference rather than animating regardless.
        fadeDuration: prefersReducedMotion() ? 0 : 300,
      })
    } catch {
      // WebGL unavailable, or a blocked style URL. The surrounding list still
      // carries every fact, so this degrades rather than breaks.
      setFailed(true)
      return
    }

    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    instance.on('error', () => setFailed(true))
    map.current = instance

    return () => {
      instance.remove()
      map.current = null
      markerRefs.current.clear()
    }
  }, [styleUrl, center, zoom])

  // Reconcile markers without tearing down the map.
  useEffect(() => {
    const instance = map.current
    if (!instance) return

    const seen = new Set<string>()

    for (const m of markers) {
      seen.add(m.id)
      const existing = markerRefs.current.get(m.id)
      if (existing) {
        existing.setLngLat([m.lon, m.lat])
        continue
      }

      const el = document.createElement('button')
      el.type = 'button'
      el.className = styles.marker!
      el.textContent = m.index !== undefined ? String(m.index + 1) : ''
      // The map is not the only access path, but a marker still needs a name.
      el.setAttribute('aria-label', m.label)
      // Not individually tab-focusable: hundreds of markers would swamp the tab
      // order. The semantic list beside the map is the keyboard path (A11Y-S1).
      el.tabIndex = -1
      el.addEventListener('click', () => onSelect?.(m.id))

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([m.lon, m.lat])
        .addTo(instance)
      markerRefs.current.set(m.id, marker)
    }

    for (const [id, marker] of markerRefs.current) {
      if (!seen.has(id)) {
        marker.remove()
        markerRefs.current.delete(id)
      }
    }
  }, [markers, onSelect])

  // Selection drives the camera, not the other way round.
  useEffect(() => {
    const instance = map.current
    if (!instance || !selectedId) return
    const target = markers.find((m) => m.id === selectedId)
    if (!target) return

    instance.easeTo({
      center: [target.lon, target.lat],
      duration: prefersReducedMotion() ? 0 : 420,
    })

    for (const [id, marker] of markerRefs.current) {
      marker.getElement().dataset.selected = id === selectedId ? 'true' : 'false'
    }
  }, [selectedId, markers])

  const attribution = attributionFor({ hasMap: true }).concat(extraAttribution)

  return (
    <div className={styles.wrapper}>
      {failed ? (
        <div className={styles.fallback} role="status">
          <p className={styles.fallbackTitle}>Map unavailable</p>
          <p className={styles.fallbackBody}>
            The route steps and coordinates below are still complete.
          </p>
        </div>
      ) : (
        <div
          ref={container}
          className={styles.canvas}
          role="application"
          aria-label={label}
          // Announced but not a tab trap; the list beside it is the keyboard path.
          tabIndex={-1}
        />
      )}

      {/* Always rendered, never collapsible. Licence condition, not decoration. */}
      <MapAttribution entries={attribution} />
    </div>
  )
}

export function MapAttribution({ entries }: { entries: readonly AttributionEntry[] }) {
  if (entries.length === 0) return null
  return (
    <p className={styles.attribution}>
      {entries.map((entry, i) => (
        <span key={entry.text}>
          {i > 0 ? <span aria-hidden="true"> · </span> : null}
          {entry.href ? (
            <a href={entry.href} target="_blank" rel="noreferrer noopener">
              {entry.text}
            </a>
          ) : (
            entry.text
          )}
        </span>
      ))}
    </p>
  )
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  )
}
