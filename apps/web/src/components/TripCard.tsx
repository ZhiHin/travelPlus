import { TIER_DESCRIPTION, type CoverageTier } from '@travelplus/domain'
import styles from './TripCard.module.css'

/**
 * A trip card on the trip-space home.
 *
 * Carries the coverage tier as a badge, so a traveller knows what the product
 * can do for that trip *before* opening it — a gap is a known condition rather
 * than a discovery made later (FR-2.9).
 *
 * The mini-ribbon uses the same stroke grammar as the full Journey Ribbon:
 * solid/filled for routed, dotted/hollow for unavailable. One visual language
 * at three scales.
 */

export interface TripCardProps {
  readonly id: string
  readonly title: string
  readonly startDate: string | null
  readonly endDate: string | null
  readonly travelerCount: number
  readonly coverageTier: CoverageTier
  readonly destinationCount: number
  readonly status: string
}

export function TripCard(props: TripCardProps) {
  const tier = TIER_DESCRIPTION[props.coverageTier]
  const routed = props.coverageTier === 'T2' || props.coverageTier === 'T3'

  return (
    <article className={styles.card}>
      <a className={styles.link} href={`/trips/${props.id}`}>
        <h3 className={styles.title}>{props.title}</h3>

        <p className={styles.meta}>
          <span className={styles.dates}>{formatRange(props.startDate, props.endDate)}</span>
          <span aria-hidden="true"> · </span>
          <span>{travellers(props.travelerCount)}</span>
        </p>

        {/* Decorative: the tier badge below carries the same information as text. */}
        <span className={styles.ribbon} data-routed={routed ? 'true' : 'false'} aria-hidden="true">
          {Array.from({ length: Math.max(1, Math.min(props.destinationCount, 5)) }, (_, i) => (
            <span key={i} className={styles.node} />
          ))}
        </span>

        <span className={styles.tier} data-tier={props.coverageTier}>
          {tier.badge}
        </span>
      </a>
    </article>
  )
}

function formatRange(start: string | null, end: string | null): string {
  if (!start && !end) return 'Dates not set'
  if (start && !end) return `From ${formatDate(start)}`
  if (!start && end) return `Until ${formatDate(end)}`
  return `${formatDate(start!)} – ${formatDate(end!)}`
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  // Constructed in UTC so the label does not shift by a day in a western zone.
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

function travellers(count: number): string {
  return count === 1 ? 'solo' : `${count} people`
}
