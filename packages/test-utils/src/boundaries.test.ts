/**
 * Proof that the module-boundary rules actually fire.
 *
 * Acceptance criterion P1-01 requires the boundary rule to fail the build when
 * `packages/domain` reaches for a framework, an ORM, an HTTP client or the
 * environment — "proven by a deliberately failing fixture". A lint config that
 * is never exercised is a config that silently stops working, so these cases
 * lint hostile source through the real project config and assert it is rejected.
 */

import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const eslint = new ESLint({ cwd: process.cwd() })

/** Lint a source string as if it lived at `filePath`, returning error messages. */
async function lintAs(filePath: string, code: string): Promise<string[]> {
  const results = await eslint.lintText(code, { filePath, warnIgnored: false })
  return results.flatMap((r) => r.messages.filter((m) => m.severity === 2).map((m) => m.message))
}

const DOMAIN_FILE = 'packages/domain/src/__boundary_fixture__.ts'

describe('MB-1 — the domain depends on nothing', () => {
  const forbidden: ReadonlyArray<[label: string, code: string, expected: RegExp]> = [
    [
      'React',
      `import { useState } from 'react'\nexport const x = useState`,
      /must not import React/,
    ],
    ['Next.js', `import Link from 'next/link'\nexport const x = Link`, /must not import Next\.js/],
    [
      'Drizzle',
      `import { pgTable } from 'drizzle-orm/pg-core'\nexport const x = pgTable`,
      /must not import an ORM/,
    ],
    [
      'a database driver',
      `import pg from 'pg'\nexport const x = pg`,
      /must not import an ORM or database driver/,
    ],
    [
      'an HTTP client',
      `import axios from 'axios'\nexport const x = axios`,
      /must not import an HTTP client/,
    ],
    [
      'a node builtin',
      `import { readFile } from 'node:fs'\nexport const x = readFile`,
      /must stay platform-free/,
    ],
    [
      'an adapter package (inward-only rule)',
      `import { db } from '@travelplus/db'\nexport const x = db`,
      /dependencies point inward/,
    ],
  ]

  for (const [label, code, expected] of forbidden) {
    it(`rejects ${label}`, async () => {
      const messages = await lintAs(DOMAIN_FILE, code)
      expect(messages.join('\n')).toMatch(expected)
    })
  }

  it('rejects reading process.env from the domain', async () => {
    const messages = await lintAs(DOMAIN_FILE, `export const url = process.env.DATABASE_URL`)
    expect(messages.join('\n')).toMatch(/only packages\/config may read the environment|reads env/)
  })

  it('accepts a pure domain module', async () => {
    const clean = `export function addMinutes(d: Date, m: number): Date {
  return new Date(d.getTime() + m * 60_000)
}
`
    expect(await lintAs(DOMAIN_FILE, clean)).toEqual([])
  })
})

describe('MB-3 — process.env is read in exactly one file', () => {
  it('rejects process.env in an app', async () => {
    const messages = await lintAs(
      'apps/web/src/thing.ts',
      `export const url = process.env.DATABASE_URL`,
    )
    expect(messages.join('\n')).toMatch(/@travelplus\/config/)
  })

  it('rejects process.env in a non-config package', async () => {
    const messages = await lintAs(
      'packages/routing/src/thing.ts',
      `export const url = process.env.OTP_BASE_URL`,
    )
    expect(messages.join('\n')).toMatch(/@travelplus\/config/)
  })

  it('permits process.env in the one file that owns it', async () => {
    const messages = await lintAs(
      'packages/config/src/index.ts',
      `export const raw = process.env\n`,
    )
    expect(messages.join('\n')).not.toMatch(/process\.env/)
  })
})

describe('the real source tree obeys its own rules', () => {
  it('lints packages/domain with zero errors', async () => {
    const results = await eslint.lintFiles(['packages/domain/src/**/*.ts'])
    const errors = results.flatMap((r) =>
      r.messages
        .filter((m) => m.severity === 2)
        .map((m) => `${r.filePath}:${m.line} ${m.ruleId ?? ''} ${m.message}`),
    )
    expect(errors).toEqual([])
  })
})
