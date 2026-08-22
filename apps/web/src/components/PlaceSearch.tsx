'use client'

import { useRef, useState } from 'react'
import styles from './PlaceSearch.module.css'

/**
 * Place search.
 *
 * The Nominatim policy forbids autocomplete against the API, so this is
 * submit-triggered: typing fires nothing (ADR-0011). That constraint is designed
 * for rather than apologised for.
 *
 * What makes it liveable is that the affordance users expect still exists —
 * recent searches and already-saved places appear as you type, because those are
 * held locally and cost no provider request. The type-ahead feel is preserved
 * exactly where it is legitimate.
 */

export interface SearchResult {
  readonly id: string
  readonly name: string
  readonly detail: string
  readonly lat: number
  readonly lon: number
  readonly attribution: string
}

export type SearchState =
  | { readonly kind: 'idle' }
  /** Waiting for the shared 1 req/s budget — a named state, not a spinner. */
  | { readonly kind: 'queued'; readonly aboutSeconds: number }
  | { readonly kind: 'searching' }
  | {
      readonly kind: 'results'
      readonly results: readonly SearchResult[]
      readonly fromCache: boolean
    }
  | { readonly kind: 'empty'; readonly query: string }
  | { readonly kind: 'error'; readonly message: string }

export interface LocalSuggestion {
  readonly id: string
  readonly name: string
  readonly kind: 'recent' | 'saved'
}

export interface PlaceSearchProps {
  readonly state: SearchState
  readonly onSearch: (query: string) => void
  readonly onSelect: (result: SearchResult) => void
  /** Local-only. Never triggers a provider request. */
  readonly localSuggestions?: readonly LocalSuggestion[]
  readonly onSelectLocal?: (id: string) => void
}

export function PlaceSearch({
  state,
  onSearch,
  onSelect,
  localSuggestions = [],
  onSelectLocal,
}: PlaceSearchProps) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  const trimmed = query.trim()
  // Local matches only — no network, so filtering per keystroke is free.
  const matches =
    trimmed.length > 0
      ? localSuggestions.filter((s) => s.name.toLowerCase().includes(trimmed.toLowerCase()))
      : []

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (trimmed.length === 0) return
    onSearch(trimmed)
  }

  return (
    <section className={styles.wrapper} aria-labelledby="search-heading">
      <h2 id="search-heading" className={styles.heading}>
        Find a place
      </h2>

      <form className={styles.form} onSubmit={submit} role="search">
        <label className={styles.label} htmlFor="place-query">
          Search for a place
        </label>
        <div className={styles.row}>
          <input
            ref={inputRef}
            id="place-query"
            className={styles.input}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Pasar Seni, Kuala Lumpur"
            // Explicitly off: the browser's own autofill is fine, but nothing
            // here may query the provider per keystroke.
            autoComplete="off"
            enterKeyHint="search"
          />
          <button className={styles.submit} type="submit" disabled={trimmed.length === 0}>
            Search
          </button>
        </div>
        <p className={styles.hint} id="search-hint">
          Press Enter or Search. Results are cached, so repeating a search is instant.
        </p>
      </form>

      {matches.length > 0 ? (
        <section aria-labelledby="local-heading" className={styles.local}>
          <h3 id="local-heading" className={styles.localHeading}>
            From your recent searches and saved places
          </h3>
          <ul className={styles.localList}>
            {matches.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className={styles.localItem}
                  onClick={() => onSelectLocal?.(s.id)}
                >
                  <span className={styles.localName}>{s.name}</span>
                  <span className={styles.localKind}>
                    {s.kind === 'saved' ? 'saved' : 'recent'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Every state change is announced; a silent queue reads as a broken box. */}
      <div className={styles.status} role="status" aria-live="polite">
        {state.kind === 'queued' ? (
          <p className={styles.queued}>Waiting for the geocoder… about {state.aboutSeconds}s</p>
        ) : null}
        {state.kind === 'searching' ? <p className={styles.queued}>Searching…</p> : null}
        {state.kind === 'empty' ? (
          <p className={styles.empty}>
            No places matched “{state.query}”. Try a broader search, or drop a pin to add it
            yourself.
          </p>
        ) : null}
        {state.kind === 'error' ? <p className={styles.error}>{state.message}</p> : null}
        {state.kind === 'results' && state.fromCache ? (
          <p className={styles.cached}>From your recent searches</p>
        ) : null}
      </div>

      {state.kind === 'results' && state.results.length > 0 ? (
        <ul className={styles.results}>
          {state.results.map((r) => (
            <li key={r.id} className={styles.result}>
              <button type="button" className={styles.resultButton} onClick={() => onSelect(r)}>
                <span className={styles.resultName}>{r.name}</span>
                <span className={styles.resultDetail}>{r.detail}</span>
                {/* Coordinates are a fact we have; opening hours are not, and
                    there is deliberately nothing here that claims them. */}
                <span className={styles.resultCoords}>
                  {r.lat.toFixed(4)}, {r.lon.toFixed(4)}
                </span>
                <span className={styles.resultAttribution}>{r.attribution}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
