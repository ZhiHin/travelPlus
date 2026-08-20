/**
 * Request-scoped database sessions.
 *
 * Every query runs inside a transaction that first sets `app.current_user_id`,
 * which is what the RLS policies read. This module is the only place a
 * connection is handed out, so there is no path to the database that skips the
 * session context — a repository cannot accidentally run unscoped.
 */

/** The subset of a database client this module needs. Keeps it testable. */
export interface QueryRunner {
  unsafe(query: string, params?: unknown[]): Promise<unknown>
}

export interface TransactionalDb {
  begin<T>(fn: (tx: QueryRunner) => Promise<T>): Promise<T>
}

/**
 * Run `fn` as `userId`, with RLS in force for the whole transaction.
 *
 * `set_config(..., true)` makes the setting transaction-local. That matters
 * under connection pooling: a session-level setting would leak to whoever gets
 * the connection next, which is a cross-user data exposure rather than a tidiness
 * issue. The `true` is load-bearing.
 */
export async function withUser<T>(
  db: TransactionalDb,
  userId: string,
  fn: (tx: QueryRunner) => Promise<T>,
): Promise<T> {
  if (!isUuidLike(userId)) {
    // Defence in depth. The value is passed as a bound parameter below, so this
    // is not the injection guard — it catches a caller passing something that is
    // not an id at all, which would otherwise silently produce an empty session.
    throw new TypeError(`withUser requires a uuid, received "${userId}"`)
  }
  return db.begin(async (tx) => {
    await tx.unsafe(`SELECT set_config('app.current_user_id', $1, true)`, [userId])
    return fn(tx)
  })
}

/**
 * Run `fn` with no actor — every RLS policy evaluates false and every
 * tenant-scoped table returns zero rows.
 *
 * Used for pre-authentication work such as looking up a session token, which is
 * why `sessions` lookups happen through a dedicated path rather than here.
 */
export async function withoutUser<T>(
  db: TransactionalDb,
  fn: (tx: QueryRunner) => Promise<T>,
): Promise<T> {
  return db.begin(async (tx) => {
    await tx.unsafe(`SELECT set_config('app.current_user_id', '', true)`)
    return fn(tx)
  })
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuidLike(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}
