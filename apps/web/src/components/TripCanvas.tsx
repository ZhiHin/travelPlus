'use client'

import { STATUS_LABEL, toLocal, type DataStatus } from '@travelplus/domain'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { JourneyDock } from './JourneyDock'
import { JourneyRibbon, type RibbonItem } from './JourneyRibbon'
import { MapCanvas, type MapMarker } from './MapCanvas'
import { PlaceSearch, type SearchResult, type SearchState } from './PlaceSearch'
import styles from './TripCanvas.module.css'

/**
 * The Journey Canvas.
 *
 * Owns the data flow for one trip: days, the selected day's items, and the
 * reorder contract. Every mutation goes preview → commit; the canvas shows the
 * preview's consequences (which legs change, which constraints break) BEFORE
 * anything is written, and a conflict on commit reloads rather than overwrites
 * (ADR-0019).
 *
 * The map and the ribbon describe the same items. Selecting on one selects on
 * the other, and neither is the only way in (ADR-0018a).
 */

interface Trip {
  readonly id: string
  readonly title: string
  readonly startDate: string | null
  readonly endDate: string | null
  readonly version: number
  readonly role: 'OWNER' | 'EDITOR' | 'VIEWER'
  readonly coverageTier: string
}

interface Day {
  readonly id: string
  readonly localDate: string
  readonly ianaZone: string
  readonly ordinal: number
  readonly version: number
}

interface Item {
  readonly id: string
  readonly kind: string
  readonly title: string
  readonly plannedDurationSeconds: number
  readonly startInstant: string | null
  readonly lockTime: boolean
  readonly lockPlace: boolean
  readonly lockItem: boolean
  readonly ordinal: number
  readonly version: number
  readonly place: { name: string; lat: number; lon: number } | null
  readonly inbound: {
    status: DataStatus
    durationSeconds: number
    transferCount: number
    walkMeters: number
  } | null
}

interface Preview {
  readonly previewToken: string
  readonly order: readonly string[]
  readonly affectedBoundaries: readonly { from: string; to: string }[]
  readonly violations: readonly { code: string; message: string; severity: string }[]
}

// Kuala Lumpur. The pilot region is the default viewport until a trip has a
// place to centre on; an empty map is better than one on the wrong continent.
const DEFAULT_CENTER: readonly [number, number] = [101.6869, 3.139]

function formatDuration(seconds: number): string {
  const m = Math.round(seconds / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r === 0 ? `${h} h` : `${h} h ${r} min`
}

function legSummary(leg: NonNullable<Item['inbound']>): string {
  const parts = [formatDuration(leg.durationSeconds)]
  if (leg.transferCount > 0) {
    parts.push(`${leg.transferCount} ${leg.transferCount === 1 ? 'transfer' : 'transfers'}`)
  }
  if (leg.walkMeters > 0) parts.push(`${Math.round(leg.walkMeters / 50) * 50} m walk`)
  return parts.join(' · ')
}

export function TripCanvas({ tripId, mapStyleUrl }: { tripId: string; mapStyleUrl: string }) {
  const [trip, setTrip] = useState<Trip | null>(null)
  const [days, setDays] = useState<readonly Day[]>([])
  const [dayId, setDayId] = useState<string | null>(null)
  const [items, setItems] = useState<readonly Item[]>([])
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [search, setSearch] = useState<SearchState>({ kind: 'idle' })
  const [loading, setLoading] = useState(true)

  const readOnly = trip?.role === 'VIEWER'
  const day = days.find((d) => d.id === dayId) ?? null

  const loadItems = useCallback(async (id: string) => {
    const r = await api<{ items: Item[] }>('GET', `/api/v1/days/${id}/items`)
    if (r.ok) setItems(r.value.items)
    else setNotice(r.error.message)
  }, [])

  // Initial load: trip, then days, then the first day's items.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const t = await api<Trip>('GET', `/api/v1/trips/${tripId}`)
      if (cancelled) return
      if (!t.ok) {
        setNotice(
          t.error.code === 'UNAUTHENTICATED' ? 'Sign in to open this trip.' : t.error.message,
        )
        setLoading(false)
        return
      }
      setTrip(t.value)

      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      const d = await api<{ items: Day[] }>(
        'GET',
        `/api/v1/trips/${tripId}/days?zone=${encodeURIComponent(zone)}`,
      )
      if (cancelled) return
      if (!d.ok) {
        setNotice(
          d.error.code === 'VALIDATION_FAILED'
            ? 'Give this trip dates to start planning days.'
            : d.error.message,
        )
        setLoading(false)
        return
      }
      setDays(d.value.items)
      const first = d.value.items[0]
      if (first) {
        setDayId(first.id)
        await loadItems(first.id)
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [tripId, loadItems])

  const selectDay = useCallback(
    async (id: string) => {
      setDayId(id)
      setPreview(null)
      setSelectedId(undefined)
      await loadItems(id)
    },
    [loadItems],
  )

  // ---- reorder: preview, show consequences, then commit --------------------

  const onReorder = useCallback(
    async (itemId: string, toIndex: number) => {
      if (!dayId) return
      const p = await api<Preview>('POST', `/api/v1/days/${dayId}/reorder/preview`, {
        itemId,
        toIndex,
      })
      if (!p.ok) {
        setNotice(p.error.message)
        return
      }
      setPreview(p.value)
    },
    [dayId],
  )

  const commit = useCallback(async () => {
    if (!dayId || !preview) return
    const c = await api<{ order: string[]; versionNumber: number }>(
      'POST',
      `/api/v1/days/${dayId}/reorder/commit`,
      { previewToken: preview.previewToken },
    )
    setPreview(null)
    if (!c.ok) {
      setNotice(
        c.error.code === 'VERSION_CONFLICT'
          ? 'Someone else changed this day first. Showing their version.'
          : c.error.message,
      )
    } else {
      setNotice(`Saved as version ${c.value.versionNumber}.`)
    }
    await loadItems(dayId)
  }, [dayId, preview, loadItems])

  // ---- items -----------------------------------------------------------

  const toggleLock = useCallback(
    async (item: Item) => {
      const r = await api<Item>('PATCH', `/api/v1/items/${item.id}`, {
        lockItem: !item.lockItem,
        ...(item.lockItem ? { lockTime: false, lockPlace: false } : {}),
        version: item.version,
      })
      if (!r.ok) setNotice(r.error.message)
      if (dayId) await loadItems(dayId)
    },
    [dayId, loadItems],
  )

  const remove = useCallback(
    async (item: Item) => {
      const r = await api<{ affectedBoundaries: unknown[] }>('DELETE', `/api/v1/items/${item.id}`, {
        version: item.version,
      })
      if (!r.ok) setNotice(r.error.message)
      else if (r.value.affectedBoundaries.length > 0) {
        setNotice('Removed. One leg now needs routing.')
      }
      if (dayId) await loadItems(dayId)
    },
    [dayId, loadItems],
  )

  const onSearch = useCallback(async (query: string) => {
    setSearch({ kind: 'searching' })
    const r = await api<
      | {
          items: {
            providerId: string
            name: string
            lat: number
            lon: number
            attribution: string
            licence: string
          }[]
          fromCache: boolean
        }
      | { status: 'queued'; retryAfterMs: number }
    >('GET', `/api/v1/places/search?q=${encodeURIComponent(query)}`)
    if (!r.ok) {
      setSearch({ kind: 'error', message: r.error.message })
      return
    }
    if ('status' in r.value) {
      setSearch({ kind: 'queued', aboutSeconds: Math.ceil(r.value.retryAfterMs / 1000) })
      return
    }
    if (r.value.items.length === 0) {
      setSearch({ kind: 'empty', query })
      return
    }
    setSearch({
      kind: 'results',
      fromCache: r.value.fromCache,
      results: r.value.items.map((p) => ({
        id: p.providerId,
        name: p.name.split(',')[0] ?? p.name,
        detail: p.name,
        lat: p.lat,
        lon: p.lon,
        attribution: p.attribution,
      })),
    })
  }, [])

  const addFromSearch = useCallback(
    async (result: SearchResult) => {
      if (!dayId) return
      const place = await api<{ id: string }>('POST', '/api/v1/places', {
        name: result.name,
        lat: result.lat,
        lon: result.lon,
        sourceId: result.id,
        attribution: result.attribution,
        allowDuplicate: true,
        ...(day ? { ianaZone: day.ianaZone } : {}),
      })
      if (!place.ok) {
        setNotice(place.error.message)
        return
      }
      const added = await api<Item>('POST', `/api/v1/days/${dayId}/items`, {
        kind: 'ACTIVITY',
        title: result.name,
        placeId: place.value.id,
      })
      if (!added.ok) {
        setNotice(added.error.message)
        return
      }
      setSearch({ kind: 'idle' })
      setSelectedId(added.value.id)
      await loadItems(dayId)
    },
    [dayId, day, loadItems],
  )

  // ---- derived views -------------------------------------------------------

  const ribbonItems = useMemo<RibbonItem[]>(() => {
    const order = preview?.order
    const ordered = order
      ? order.map((id) => items.find((i) => i.id === id)).filter((i): i is Item => !!i)
      : items
    const changed = new Set(preview?.affectedBoundaries.map((b) => b.to) ?? [])

    return ordered.map((item, index) => {
      const violations = (preview?.violations ?? []).filter((v) => v.message.includes(item.title))
      const previousId = ordered[index - 1]?.id
      // In a preview, a leg whose adjacency changed no longer applies: show it
      // as needing routing rather than carrying the old duration across.
      const legInvalid = preview && previousId !== undefined && changed.has(item.id)
      const inbound =
        index === 0
          ? null
          : item.inbound && !legInvalid
            ? {
                status: item.inbound.status,
                summary: legSummary(item.inbound),
                isTransfer: item.inbound.transferCount > 0,
              }
            : { status: 'UNAVAILABLE' as const, summary: 'Not routed yet', isTransfer: false }

      return {
        id: item.id,
        title: item.title,
        kind: item.kind,
        startLabel:
          item.startInstant && day ? toLocal(new Date(item.startInstant), day.ianaZone).time : null,
        durationLabel: formatDuration(item.plannedDurationSeconds),
        locked: item.lockItem || item.lockTime || item.lockPlace,
        inbound,
        violations: violations.map((v) => v.message),
      }
    })
  }, [items, preview, day])

  const markers = useMemo<MapMarker[]>(
    () =>
      items
        .filter((i) => i.place)
        .map((i, index) => ({
          id: i.id,
          lat: i.place!.lat,
          lon: i.place!.lon,
          label: i.title,
          index: index + 1,
        })),
    [items],
  )

  const center = useMemo<readonly [number, number]>(() => {
    const first = markers[0]
    return first ? [first.lon, first.lat] : DEFAULT_CENTER
  }, [markers])

  const selected = items.find((i) => i.id === selectedId) ?? null

  return (
    <>
      <div className={styles.canvas}>
        <div className={styles.mapPane}>
          <MapCanvas
            styleUrl={mapStyleUrl}
            center={center}
            zoom={markers.length > 0 ? 13 : 11}
            markers={markers}
            selectedId={selectedId}
            onSelect={setSelectedId}
            label={trip ? `Map of ${trip.title}` : 'Trip map'}
          />
        </div>

        <main id="itinerary" className={styles.sidePane} aria-busy={loading}>
          <header className={styles.header}>
            <p className={styles.eyebrow}>
              {trip?.coverageTier ?? '—'} · {readOnly ? 'view only' : 'editing'}
            </p>
            <h1 className={styles.title}>{trip?.title ?? 'Trip'}</h1>
          </header>

          {notice ? (
            <p className={styles.notice} role="status">
              {notice}{' '}
              <button type="button" className={styles.linkButton} onClick={() => setNotice(null)}>
                Dismiss
              </button>
            </p>
          ) : null}

          {days.length > 0 ? (
            <nav aria-label="Days" className={styles.days}>
              {days.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className={styles.dayTab}
                  aria-current={d.id === dayId ? 'page' : undefined}
                  onClick={() => selectDay(d.id)}
                >
                  <span className={styles.dayOrdinal}>Day {d.ordinal + 1}</span>
                  <span className={styles.dayDate}>{d.localDate}</span>
                </button>
              ))}
            </nav>
          ) : null}

          {!readOnly && dayId ? (
            <PlaceSearch state={search} onSearch={onSearch} onSelect={addFromSearch} />
          ) : null}

          {preview ? (
            <div className={styles.preview} role="region" aria-label="Proposed change">
              <p className={styles.previewTitle}>
                {preview.affectedBoundaries.length} leg
                {preview.affectedBoundaries.length === 1 ? '' : 's'} will need routing.
                {preview.violations.length > 0
                  ? ` ${preview.violations.length} thing${preview.violations.length === 1 ? '' : 's'} to check.`
                  : ''}
              </p>
              {preview.violations.length > 0 ? (
                <ul className={styles.previewList}>
                  {preview.violations.map((v, i) => (
                    <li key={`${v.code}-${i}`} data-severity={v.severity}>
                      {v.message}
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className={styles.previewActions}>
                <button type="button" className={styles.primary} onClick={commit}>
                  Apply
                </button>
                <button type="button" className={styles.secondary} onClick={() => setPreview(null)}>
                  Keep current order
                </button>
              </div>
            </div>
          ) : null}

          <JourneyRibbon
            items={ribbonItems}
            selectedId={selectedId}
            onSelect={setSelectedId}
            readOnly={readOnly || !!preview}
            onReorder={onReorder}
          />

          {selected ? (
            <section className={styles.detail} aria-label={`${selected.title} details`}>
              <h2 className={styles.detailTitle}>{selected.title}</h2>
              <dl className={styles.detailList}>
                <dt>Kind</dt>
                <dd>{selected.kind.toLowerCase().replace('_', ' ')}</dd>
                <dt>Planned</dt>
                <dd>{formatDuration(selected.plannedDurationSeconds)}</dd>
                {selected.place ? (
                  <>
                    <dt>Place</dt>
                    <dd>{selected.place.name}</dd>
                  </>
                ) : null}
                {selected.inbound ? (
                  <>
                    <dt>Getting here</dt>
                    <dd>
                      {legSummary(selected.inbound)} · {STATUS_LABEL[selected.inbound.status]}
                    </dd>
                  </>
                ) : null}
              </dl>
              {!readOnly ? (
                <div className={styles.detailActions}>
                  <button
                    type="button"
                    className={styles.secondary}
                    onClick={() => toggleLock(selected)}
                  >
                    {selected.lockItem ? 'Unlock' : 'Lock in place'}
                  </button>
                  <button
                    type="button"
                    className={styles.danger}
                    onClick={() => remove(selected)}
                    disabled={selected.lockItem}
                  >
                    Remove
                  </button>
                </div>
              ) : null}
            </section>
          ) : null}
        </main>
      </div>
      <JourneyDock current="trips" />
    </>
  )
}
