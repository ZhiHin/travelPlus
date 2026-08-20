'use client'

import { useCallback, useRef, useState } from 'react'
import styles from './JourneyDock.module.css'

/**
 * The Journey Dock (ADR-0018).
 *
 * Centred and floating on desktop as well as mobile — deliberately not anchored
 * left, because the map is the ground plane and a left-anchored bar would
 * reintroduce the sidebar this product is defined against.
 *
 * Accessibility (A-O8): the dock is ONE tab stop with arrow-key navigation
 * inside, following the toolbar pattern. Five separate tab stops would make a
 * keyboard user traverse the whole dock to reach the map, every time.
 */

export interface DockItem {
  readonly id: string
  readonly label: string
  readonly href: string
  readonly icon: string
}

const ITEMS: readonly DockItem[] = [
  { id: 'trips', label: 'Trips', href: '/trips', icon: '◫' },
  { id: 'discover', label: 'Discover', href: '/discover', icon: '⌕' },
  { id: 'plan', label: 'Plan', href: '/plan', icon: '◆' },
  { id: 'today', label: 'Today', href: '/today', icon: '◷' },
  { id: 'profile', label: 'Profile', href: '/profile', icon: '◐' },
]

export function JourneyDock({ current = 'trips' }: { current?: string }) {
  const currentIndex = Math.max(
    0,
    ITEMS.findIndex((i) => i.id === current),
  )
  // Roving tabindex: focus follows the arrow keys, but only one item is ever
  // reachable by Tab.
  const [focusIndex, setFocusIndex] = useState(currentIndex)
  const refs = useRef<Array<HTMLAnchorElement | null>>([])

  const move = useCallback((to: number) => {
    const next = (to + ITEMS.length) % ITEMS.length
    setFocusIndex(next)
    refs.current[next]?.focus()
  }, [])

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          event.preventDefault()
          move(focusIndex + 1)
          break
        case 'ArrowLeft':
        case 'ArrowUp':
          event.preventDefault()
          move(focusIndex - 1)
          break
        case 'Home':
          event.preventDefault()
          move(0)
          break
        case 'End':
          event.preventDefault()
          move(ITEMS.length - 1)
          break
        default:
          break
      }
    },
    [focusIndex, move],
  )

  return (
    <nav className={styles.dock} aria-label="Primary" onKeyDown={onKeyDown}>
      <ul className={styles.list}>
        {ITEMS.map((item, index) => {
          const isCurrent = item.id === current
          return (
            <li key={item.id}>
              <a
                ref={(el) => {
                  refs.current[index] = el
                }}
                href={item.href}
                className={styles.item}
                // Exactly one item is tabbable; the rest are reached by arrows.
                tabIndex={index === focusIndex ? 0 : -1}
                aria-current={isCurrent ? 'page' : undefined}
                onFocus={() => setFocusIndex(index)}
              >
                <span className={styles.icon} aria-hidden="true">
                  {item.icon}
                </span>
                <span className={styles.label}>{item.label}</span>
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
