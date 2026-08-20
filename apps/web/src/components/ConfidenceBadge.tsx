import {
  STATUS_LABEL,
  STATUS_NODE,
  STATUS_STROKE,
  requiresAgeDisplay,
  type DataStatus,
} from '@travelplus/domain'
import styles from './ConfidenceBadge.module.css'

/**
 * The confidence badge — the product's most repeated UI element.
 *
 * Three independent channels carry the status: the word, the stroke texture and
 * the node fill. Colour is a fourth, never the only one, so the six states stay
 * distinguishable in greyscale and for colour-blind users (A11Y-S2).
 *
 * The vocabulary comes from the domain rather than from strings written here, so
 * "scheduled" cannot drift into "timetabled" in one corner of the app.
 */

export interface ConfidenceBadgeProps {
  readonly status: DataStatus
  /** When the provider answered. Required for REALTIME and STALE. */
  readonly retrievedAt?: Date
  readonly now?: Date
}

function formatAge(from: Date, now: Date): string {
  const seconds = Math.max(0, Math.round((now.getTime() - from.getTime()) / 1000))
  if (seconds < 60) return `${seconds} s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`
}

export function ConfidenceBadge({ status, retrievedAt, now }: ConfidenceBadgeProps) {
  const label = STATUS_LABEL[status]
  const stroke = STATUS_STROKE[status]
  const node = STATUS_NODE[status]

  // "Live" without an age is a claim nobody can check, so the age is part of the
  // badge rather than an optional extra (FR-12.4).
  const showAge = requiresAgeDisplay(status)
  const age = showAge && retrievedAt ? formatAge(retrievedAt, now ?? new Date()) : null

  return (
    <span
      className={styles.badge}
      data-status={status}
      data-stroke={stroke}
      data-node={node}
      // The whole badge reads as one phrase to a screen reader.
      aria-label={age ? `${label}, updated ${age}` : label}
    >
      <span className={styles.mark} aria-hidden="true" />
      <span className={styles.label}>{label}</span>
      {age ? (
        <>
          <span className={styles.separator} aria-hidden="true">
            ·
          </span>
          <time className={styles.age} dateTime={retrievedAt?.toISOString()}>
            {age}
          </time>
        </>
      ) : null}
    </span>
  )
}
