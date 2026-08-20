import postgres from 'postgres'
import {
  withUser as withUserOn,
  withoutUser as withoutUserOn,
  type TransactionalDb,
} from './session.js'

/**
 * The database client.
 *
 * Two roles, deliberately separate connections:
 *
 *  - `app`   runs every request. Subject to forced RLS, so a missing predicate
 *            returns nothing rather than another user's data.
 *  - `system` runs pre-authentication lookups (session token resolution) and
 *            background jobs, where no user actor exists yet.
 *
 * Splitting them means the request path physically cannot escape RLS, rather
 * than relying on remembering to set a session variable.
 */

export type Sql = postgres.Sql

export interface DbOptions {
  readonly appUrl: string
  readonly systemUrl?: string
  readonly max?: number
}

let appSql: Sql | undefined
let systemSql: Sql | undefined

function create(url: string, max: number): Sql {
  return postgres(url, {
    max,
    // Notices are operational noise; real errors still throw.
    onnotice: () => {},
    // Fail fast rather than queueing behind an unreachable database.
    connect_timeout: 10,
    idle_timeout: 30,
  })
}

export function initDb(options: DbOptions): void {
  appSql ??= create(options.appUrl, options.max ?? 10)
  systemSql ??= create(options.systemUrl ?? options.appUrl, 2)
}

export function db(): Sql {
  if (!appSql) throw new Error('initDb() must be called before db()')
  return appSql
}

export function systemDb(): Sql {
  if (!systemSql) throw new Error('initDb() must be called before systemDb()')
  return systemSql
}

export async function closeDb(): Promise<void> {
  await Promise.all([appSql?.end({ timeout: 5 }), systemSql?.end({ timeout: 5 })])
  appSql = undefined
  systemSql = undefined
}

/**
 * Run `fn` inside a transaction with the RLS actor set.
 *
 * The session-context logic itself lives in `session.ts`, where it is unit
 * tested against a fake runner — including the property that `set_config` is
 * transaction-local rather than session-scoped. These wrappers only bind it to
 * the live pool, so there is exactly one implementation to get right.
 */
export async function withUser<T>(userId: string, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return withUserOn(db() as unknown as TransactionalDb, userId, fn as never) as Promise<T>
}

/**
 * Run `fn` with no actor. Every RLS policy evaluates false, so every
 * tenant-scoped table returns zero rows.
 */
export async function withoutUser<T>(fn: (tx: Sql) => Promise<T>): Promise<T> {
  return withoutUserOn(db() as unknown as TransactionalDb, fn as never) as Promise<T>
}
