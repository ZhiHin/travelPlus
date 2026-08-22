'use client'

import { STATUS_LABEL, type DataStatus } from '@travelplus/domain'
import { useCallback, useId, useRef, useState } from 'react'
import styles from './JourneyRibbon.module.css'

/**
 * The Journey Ribbon — the itinerary drawn as a transit diagram.
 *
 * The stroke grammar is the product's signature and its accessibility answer at
 * once: solid/filled for routed, dashed for estimated, dotted/hollow for
 * unavailable, a ring for locked. Status is carried by shape and text, never by
 * colour alone, so it survives greyscale (A11Y-S2).
 *
 * Reordering has a keyboard path OF EQUAL POWER to dragging (A-O5, A-O14):
 * Space grabs, arrows move, Space drops, Escape cancels. Each step is announced
 * through a live region, and the same preview-before-commit contract applies.
 * This is not a lesser path; it is the same operation through a different input.
 */

export interface RibbonItem {
  readonly id: string
  readonly title: string
  readonly kind: string
  readonly startLabel: string | null
  readonly durationLabel: string
  readonly locked: boolean
  /** The leg that arrives here, or null for the first item. */
  readonly inbound: {
    readonly status: DataStatus
    readonly summary: string
    readonly isTransfer: boolean
  } | null
  readonly violations: readonly string[]
}

export interface JourneyRibbonProps {
  readonly items: readonly RibbonItem[]
  readonly selectedId?: string | undefined
  readonly onSelect?: (id: string) => void
  /** Called with the proposed order; the host previews and commits. */
  readonly onReorder?: (itemId: string, toIndex: number) => void
  readonly readOnly?: boolean
}

const STROKE: Record<DataStatus, string> = {
  REALTIME: 'solid',
  SCHEDULED: 'solid',
  ESTIMATED: 'dashed',
  MANUAL: 'solid',
  STALE: 'dashed',
  UNAVAILABLE: 'dotted',
}

export function JourneyRibbon({
  items,
  selectedId,
  onSelect,
  onReorder,
  readOnly = false,
}: JourneyRibbonProps) {
  const liveId = useId()
  const [grabbed, setGrabbed] = useState<{ id: string; index: number } | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const refs = useRef<Array<HTMLLIElement | null>>([])

  const announce = useCallback((text: string) => setAnnouncement(text), [])

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent, item: RibbonItem, index: number) => {
      if (readOnly || !onReorder) return

      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault()
        if (item.locked) {
          announce(`${item.title} is locked and cannot be moved.`)
          return
        }
        if (!grabbed) {
          setGrabbed({ id: item.id, index })
          announce(
            `${item.title}, position ${index + 1} of ${items.length}. Grabbed. Use arrow keys to move, Space to drop, Escape to cancel.`,
          )
        } else {
          onReorder(grabbed.id, grabbed.index)
          announce(
            `${item.title} dropped at position ${grabbed.index + 1}. Reviewing affected legs.`,
          )
          setGrabbed(null)
        }
        return
      }

      if (!grabbed) return

      if (event.key === 'Escape') {
        event.preventDefault()
        announce(`Move cancelled. ${item.title} stays at position ${index + 1}.`)
        setGrabbed(null)
        refs.current[index]?.focus()
        return
      }

      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault()
        const delta = event.key === 'ArrowUp' ? -1 : 1
        const next = Math.max(0, Math.min(items.length - 1, grabbed.index + delta))
        if (next === grabbed.index) {
          announce(event.key === 'ArrowUp' ? 'Already first.' : 'Already last.')
          return
        }
        setGrabbed({ id: grabbed.id, index: next })
        const changed = Math.abs(next - index) <= 1 ? 2 : 4
        announce(
          `Moving ${event.key === 'ArrowUp' ? 'up' : 'down'}. Position ${next + 1} of ${items.length}. ${changed} legs will change.`,
        )
        refs.current[next]?.focus()
      }
    },
    [announce, grabbed, items.length, onReorder, readOnly],
  )

  return (
    <section className={styles.ribbon} aria-label="Itinerary">
      {/* Announced at every step; a silent keyboard reorder is an unusable one. */}
      <div id={liveId} className="visually-hidden" role="status" aria-live="assertive">
        {announcement}
      </div>

      {!readOnly && onReorder ? (
        <p className={styles.hint} id={`${liveId}-hint`}>
          Press Space on an item to pick it up, arrow keys to move it, Space to drop.
        </p>
      ) : null}

      <ol className={styles.list} aria-describedby={!readOnly ? `${liveId}-hint` : undefined}>
        {items.map((item, index) => {
          const isSelected = item.id === selectedId
          const isGrabbed = grabbed?.id === item.id
          const status = item.inbound?.status

          return (
            <li
              key={item.id}
              ref={(el) => {
                refs.current[index] = el
              }}
              className={styles.item}
              data-selected={isSelected}
              data-grabbed={isGrabbed}
              data-locked={item.locked}
              tabIndex={0}
              aria-current={isSelected ? 'true' : undefined}
              aria-grabbed={isGrabbed}
              onClick={() => onSelect?.(item.id)}
              onKeyDown={(e) => onKeyDown(e, item, index)}
            >
              {/* The leg INTO this item: drawn above the node. Presentational —
                  the same fact is in the text beside it. */}
              {item.inbound ? (
                <span
                  className={styles.stroke}
                  data-stroke={status ? STROKE[status] : 'dotted'}
                  data-transfer={item.inbound.isTransfer}
                  aria-hidden="true"
                />
              ) : null}

              <span
                className={styles.node}
                data-hollow={status === 'UNAVAILABLE' || status === 'STALE'}
                data-locked={item.locked}
                data-pulse={status === 'REALTIME'}
                aria-hidden="true"
              />

              <span className={styles.body}>
                {item.inbound ? (
                  <span className={styles.leg}>
                    <span className={styles.legSummary}>{item.inbound.summary}</span>
                    <span className={styles.legStatus}>{STATUS_LABEL[item.inbound.status]}</span>
                  </span>
                ) : null}

                <span className={styles.head}>
                  {item.startLabel ? (
                    <time className={styles.time}>{item.startLabel}</time>
                  ) : (
                    <span className={styles.time} data-unset="true">
                      — —
                    </span>
                  )}
                  <span className={styles.title}>{item.title}</span>
                  <span className={styles.duration}>{item.durationLabel}</span>
                  {item.locked ? (
                    <span className={styles.lock} aria-label="locked">
                      locked
                    </span>
                  ) : null}
                </span>

                {item.violations.length > 0 ? (
                  <ul className={styles.violations} aria-label="Problems with this item">
                    {item.violations.map((v) => (
                      <li key={v} className={styles.violation}>
                        {v}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </span>
            </li>
          )
        })}
      </ol>

      {items.length === 0 ? (
        <p className={styles.empty}>Nothing planned yet. Add a place to begin the day.</p>
      ) : null}
    </section>
  )
}
