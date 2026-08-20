// The concrete, pool-bound API. `session.ts` holds the generic session-context
// logic it delegates to and is unit tested directly; it is intentionally not
// re-exported, so callers have one obvious way to open a scoped transaction.
export * from './client.js'
export * from './migrate.js'
