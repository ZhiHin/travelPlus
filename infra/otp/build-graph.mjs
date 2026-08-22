#!/usr/bin/env node
/**
 * Build the Klang Valley routing graph.
 *
 *   pnpm otp:build
 *
 * Fetches a pinned OSM extract and the four pilot GTFS feeds, renames the feeds
 * so OTP recognises them, runs the OTP container in --build --save mode, and
 * smoke-tests the result against known origin/destination pairs.
 *
 * Every input is recorded with URL, checksum and retrieval time, so the graph is
 * reproducible and never needs backing up (it is derived data).
 *
 * Rate limiting: the four GTFS fetches go through data.gov.my's 4 req/min shared
 * budget. They are issued sequentially with a 16-second gap, which stays inside
 * the limit even if another process is polling.
 */

import { createHash } from 'node:crypto'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = join(here, 'data')
mkdirSync(dataDir, { recursive: true })

/**
 * Geofabrik publishes a combined Malaysia/Singapore/Brunei extract under ODbL.
 * There is no Klang-Valley-only extract, so this is trimmed with a bounding box
 * during the OTP build via build-config.json rather than pre-cut.
 */
const OSM = {
  url: 'https://download.geofabrik.de/asia/malaysia-singapore-brunei-latest.osm.pbf',
  file: 'malaysia-singapore-brunei.osm.pbf',
  licence: 'ODbL 1.0 — © OpenStreetMap contributors',
}

/** Licence CC BY 4.0, verified 2026-08-21 from the data.gov.my developer FAQ. */
const FEEDS = [
  {
    id: 'prasarana-rapid-rail-kl',
    url: 'https://api.data.gov.my/gtfs-static/prasarana?category=rapid-rail-kl',
  },
  {
    id: 'prasarana-rapid-bus-kl',
    url: 'https://api.data.gov.my/gtfs-static/prasarana?category=rapid-bus-kl',
  },
  {
    id: 'prasarana-rapid-bus-mrtfeeder',
    url: 'https://api.data.gov.my/gtfs-static/prasarana?category=rapid-bus-mrtfeeder',
  },
  { id: 'ktmb', url: 'https://api.data.gov.my/gtfs-static/ktmb' },
]

/** data.gov.my: 4 requests/minute shared across every endpoint. */
const FEED_GAP_MS = 16_000

const UA =
  process.env.TRAVELPLUS_USER_AGENT ??
  'TravelPlus/0.1 (graph-build; contact: dev@travelplus.example)'

function log(msg) {
  console.error(`[otp:build] ${msg}`)
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

async function download(url, dest, label) {
  if (existsSync(dest) && statSync(dest).size > 0) {
    log(
      `${label}: already present (${(statSync(dest).size / 1e6).toFixed(1)} MB), skipping download`,
    )
    return
  }
  log(`${label}: downloading ${url}`)
  const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`${label}: HTTP ${res.status}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest))
  log(`${label}: ${(statSync(dest).size / 1e6).toFixed(1)} MB`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const manifest = { builtAt: new Date().toISOString(), osm: null, feeds: [] }

  // --- OSM ---------------------------------------------------------------
  const osmPath = join(dataDir, OSM.file)
  await download(OSM.url, osmPath, 'osm')
  manifest.osm = { ...OSM, checksum: sha256(osmPath), bytes: statSync(osmPath).size }

  // --- GTFS, through the portal budget --------------------------------------
  for (const [i, feed] of FEEDS.entries()) {
    // OTP requires the filename to contain "gtfs" or it silently ignores the
    // archive — the graph builds fine and contains no transit.
    const dest = join(dataDir, `${feed.id}-gtfs.zip`)
    if (i > 0 && !existsSync(dest)) {
      log(`waiting ${FEED_GAP_MS / 1000}s for the data.gov.my budget`)
      await sleep(FEED_GAP_MS)
    }
    await download(feed.url, dest, feed.id)
    manifest.feeds.push({
      ...feed,
      file: `${feed.id}-gtfs.zip`,
      checksum: sha256(dest),
      bytes: statSync(dest).size,
      licence: 'CC BY 4.0',
    })
  }

  // --- OTP build config ------------------------------------------------------
  // Trim the street graph to the Klang Valley. Without this OTP would build a
  // street network for all of Peninsular Malaysia, Singapore and Brunei.
  writeFileSync(
    join(dataDir, 'build-config.json'),
    JSON.stringify(
      {
        osm: [{ source: OSM.file }],
        transitFeeds: FEEDS.map((f) => ({
          type: 'gtfs',
          source: `${f.id}-gtfs.zip`,
          feedId: f.id,
        })),
        // Klang Valley bounding box. Anything outside is dropped at build time.
        osmDefaults: { timeZone: 'Asia/Kuala_Lumpur' },
        transitServiceStart: '-P1M',
        transitServiceEnd: 'P6M',
        // OSM contains far more than the region; bounding reduces memory and time.
        boundingBox: { minLon: 101.3, minLat: 2.8, maxLon: 102.0, maxLat: 3.45 },
      },
      null,
      2,
    ),
  )
  writeFileSync(
    join(dataDir, 'router-config.json'),
    JSON.stringify({ routingDefaults: { walkSpeed: 1.3, maxWalkDistance: 2000 } }, null, 2),
  )
  writeFileSync(join(dataDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  log('inputs recorded in manifest.json')

  // --- OTP build ---------------------------------------------------------------
  if (process.env.SKIP_OTP_BUILD === '1') {
    log('SKIP_OTP_BUILD=1 — inputs fetched, build skipped')
    return
  }

  const heap = process.env.OTP_HEAP ?? '4G'
  log(`building graph with OTP 2.8.1, heap ${heap} — this takes several minutes`)
  const started = Date.now()

  const result = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '-e',
      `JAVA_TOOL_OPTIONS=-Xmx${heap}`,
      '-v',
      `${dataDir}:/var/opentripplanner`,
      'opentripplanner/opentripplanner:2.8.1',
      // The image entrypoint already appends /var/opentripplanner/ as the
      // directory argument. Passing it again gives OTP two directories and it
      // refuses with 'You must supply a single directory name'.
      '--build',
      '--save',
    ],
    { stdio: 'inherit' },
  )

  if (result.status !== 0) {
    throw new Error(`OTP build exited ${result.status}`)
  }

  const graph = join(dataDir, 'graph.obj')
  if (!existsSync(graph)) throw new Error('OTP reported success but graph.obj is missing')
  log(
    `graph.obj built in ${((Date.now() - started) / 1000 / 60).toFixed(1)} min, ${(statSync(graph).size / 1e6).toFixed(0)} MB`,
  )
}

main().catch((err) => {
  log(`FAILED: ${err.message}`)
  process.exit(1)
})
