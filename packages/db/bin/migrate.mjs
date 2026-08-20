#!/usr/bin/env node
// CLI entry for `pnpm db:migrate`.
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { migrate } from '../src/migrate.ts'

const here = dirname(fileURLToPath(import.meta.url))
const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is required. Copy .env.example to .env and set it.')
  process.exit(1)
}

try {
  const { applied, skipped } = await migrate(url, join(here, '..', 'migrations'))
  if (skipped.length) console.error(`already applied: ${skipped.join(', ')}`)
  if (applied.length) console.error(`applied: ${applied.join(', ')}`)
  else console.error('nothing to apply — schema is up to date')
} catch (err) {
  console.error(`migration failed: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
