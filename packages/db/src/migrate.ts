/**
 * Forward-only SQL migration runner.
 *
 * Deliberately small and boring. Migrations are plain reviewable SQL files
 * (ADR-0004) because PostGIS types, GiST indexes, RLS policies and partial
 * unique indexes are not expressible in a schema DSL — and because a migration
 * that touches the security model must be readable in review.
 *
 * Properties that matter:
 *  - Forward only. There is no `down`. A mistake is corrected by a new migration,
 *    so production and development converge on the same path.
 *  - Each file runs inside a transaction and is recorded in the same transaction,
 *    so a failure leaves neither a partial schema nor a false ledger entry.
 *  - A checksum is stored. Editing an applied migration is caught rather than
 *    silently diverging between machines.
 *  - An advisory lock serialises concurrent runners.
 */

import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import postgres from 'postgres'

export interface MigrationFile {
  readonly name: string
  readonly sql: string
  readonly checksum: string
}

/** Numeric-prefix ordering: 0002 must follow 0001, and 0010 must follow 0009. */
export function sortMigrations(names: readonly string[]): string[] {
  return [...names]
    .filter((n) => n.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
}

export function checksum(sql: string): string {
  // Normalise line endings so a Windows checkout and a Linux CI agree.
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex')
}

export async function loadMigrations(dir: string): Promise<MigrationFile[]> {
  const names = sortMigrations(await readdir(dir))
  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(join(dir, name), 'utf8')
      return { name, sql, checksum: checksum(sql) }
    }),
  )
}

const LEDGER = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    name        text PRIMARY KEY,
    checksum    text NOT NULL,
    applied_at  timestamptz NOT NULL DEFAULT now()
  )
`

export interface MigrateResult {
  readonly applied: string[]
  readonly skipped: string[]
}

export async function migrate(databaseUrl: string, dir: string): Promise<MigrateResult> {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} })
  const applied: string[] = []
  const skipped: string[] = []

  try {
    await sql.unsafe(LEDGER)
    // Serialise concurrent runners (two CI jobs, or a dev and a test run).
    await sql`SELECT pg_advisory_lock(4711147)`

    const rows = await sql<{ name: string; checksum: string }[]>`
      SELECT name, checksum FROM schema_migrations
    `
    const seen = new Map(rows.map((r) => [r.name, r.checksum]))

    for (const m of await loadMigrations(dir)) {
      const previous = seen.get(m.name)

      if (previous !== undefined) {
        if (previous !== m.checksum) {
          // An applied migration was edited. Silently ignoring this is how two
          // machines end up with different schemas and the same ledger.
          throw new Error(
            `Migration "${m.name}" has changed since it was applied.\n` +
              `  applied checksum: ${previous}\n` +
              `  current checksum: ${m.checksum}\n` +
              `Migrations are immutable once applied — add a new one instead.`,
          )
        }
        skipped.push(m.name)
        continue
      }

      // The file supplies its own BEGIN/COMMIT, so the ledger insert is appended
      // inside that same transaction rather than opening a nested one.
      await sql.unsafe(
        m.sql.replace(
          /COMMIT\s*;?\s*$/i,
          `INSERT INTO schema_migrations (name, checksum) VALUES ('${m.name}', '${m.checksum}');\nCOMMIT;`,
        ),
      )
      applied.push(m.name)
    }

    await sql`SELECT pg_advisory_unlock(4711147)`
    return { applied, skipped }
  } finally {
    await sql.end({ timeout: 5 })
  }
}
