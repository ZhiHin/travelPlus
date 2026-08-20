import { defineConfig } from 'vitest/config'

/**
 * Integration tests — real PostgreSQL, real migration, real RLS.
 *
 * Kept in a separate config from the unit suite so `pnpm test` stays fast and
 * runs anywhere, while `pnpm test:integration` requires a database. Both are
 * required by the phase gate; neither is optional.
 */
export default defineConfig({
  test: {
    include: ['packages/**/*.itest.ts', 'apps/**/*.itest.ts'],
    environment: 'node',
    // RLS tests share seeded rows and assert on row counts; parallel files would
    // race each other rather than test the policies.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
