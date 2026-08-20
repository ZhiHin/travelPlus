import { DATA_STATUSES } from '@travelplus/domain'
import { ConfidenceBadge } from '../components/ConfidenceBadge'
import { JourneyDock } from '../components/JourneyDock'
import styles from './page.module.css'

/**
 * Phase 1 shell.
 *
 * Not the Journey Canvas yet — the map, ribbon and sheets arrive in Phases 2-4.
 * What this page does carry is the design system and the confidence vocabulary,
 * so the accessibility gates run against something real rather than a
 * placeholder, and so the six states are visible in review from day one.
 */

const NOW = new Date('2026-08-20T10:00:00Z')
const RECENT = new Date('2026-08-20T09:59:19Z')
const OLD = new Date('2026-08-20T07:04:00Z')

export default function HomePage() {
  return (
    <>
      <main id="itinerary" className={styles.page}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>Phase 1 · foundation</p>
          <h1 className={styles.title}>TravelPlus</h1>
          <p className={styles.lede}>
            Map-first travel planning where every route has been verified against real transit data
            — and where a gap is shown as a gap.
          </p>
        </header>

        <section className={styles.section} aria-labelledby="confidence-heading">
          <h2 id="confidence-heading" className={styles.sectionTitle}>
            Data confidence
          </h2>
          <p className={styles.note}>
            Six states, one vocabulary, shared by the database, the API and this page. Status is
            carried by the word, the mark shape and the stroke as well as colour, so it survives
            greyscale and colour blindness.
          </p>

          <ul className={styles.badgeGrid}>
            {DATA_STATUSES.map((status) => (
              <li key={status} className={styles.badgeRow}>
                <ConfidenceBadge
                  status={status}
                  retrievedAt={status === 'STALE' ? OLD : RECENT}
                  now={NOW}
                />
                <code className={styles.code}>{status}</code>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.section} aria-labelledby="pilot-heading">
          <h2 id="pilot-heading" className={styles.sectionTitle}>
            Pilot region
          </h2>
          <p className={styles.note}>
            Kuala Lumpur / Klang Valley, using openly published GTFS from data.gov.my — Prasarana
            rail, bus and MRT feeder, plus KTMB commuter rail. No API key is required for any of it.
          </p>
          <p className={styles.note}>
            The pilot ships at <strong>scheduled</strong> confidence rather than live, because
            Malaysia currently publishes GTFS-Realtime vehicle positions only, and vehicle positions
            carry no predicted stop times. A moving vehicle marker is not a predicted arrival, and
            this product will not present one as the other.
          </p>
        </section>

        <footer className={styles.footer}>
          <p className={styles.attribution}>
            Map data will be attributed here: OpenFreeMap © OpenMapTiles Data from OpenStreetMap
          </p>
        </footer>
      </main>

      <JourneyDock current="trips" />
    </>
  )
}
