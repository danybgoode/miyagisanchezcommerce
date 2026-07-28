/** Server-only persistence/read seam for the Golden Beans durable snapshot. */
import 'server-only'
import type { FlagSnapshot } from '@golden-beans/sdk'
import { db } from '@/lib/supabase'
import { parseGoldenFlagEnvironment, type GoldenFlagEnvironment } from '@/lib/flag-provider-mode'
import { parseDurableGoldenSnapshot } from '@/lib/golden-flag-mirror'

const TABLE = 'golden_flag_snapshot_mirror'
const MIRROR_CACHE_TTL_MS = 60_000
const MIRROR_FETCH_TIMEOUT_MS = 2_000

const cache: { snapshot: FlagSnapshot | undefined; environment: GoldenFlagEnvironment | undefined; fetchedAt: number | undefined } = {
  snapshot: undefined,
  environment: undefined,
  fetchedAt: undefined,
}
let inflight: Promise<FlagSnapshot | undefined> | undefined
const lastSuccessfulPersistByEnvironment = new Map<string, { snapshotVersion: number; at: number }>()
const persistenceInflightByEnvironment = new Map<string, { snapshotVersion: number; token: symbol }>()

/** Never let an out-of-order provider refresh or database read roll back the local LKG snapshot. */
function retainInMemorySnapshot(snapshot: FlagSnapshot): void {
  if (
    cache.environment === snapshot.environment &&
    cache.snapshot &&
    cache.snapshot.snapshotVersion > snapshot.snapshotVersion
  )
    return
  cache.snapshot = snapshot
  cache.environment = snapshot.environment
  cache.fetchedAt = Date.now()
}

/**
 * Persist out of band: a flag decision must never wait for its resilience
 * fallback. The RPC performs the monotonic, atomic compare-and-store.
 */
export function scheduleDurableGoldenSnapshot(snapshot: FlagSnapshot): void {
  // A snapshot which reached the live provider is already contract-validated. Retain it in-process
  // immediately; the RPC below makes that same last-known-good value durable without making a flag
  // decision wait for database I/O.
  retainInMemorySnapshot(snapshot)

  const previous = lastSuccessfulPersistByEnvironment.get(snapshot.environment)
  const now = Date.now()
  if (previous && previous.snapshotVersion === snapshot.snapshotVersion && now - previous.at < MIRROR_CACHE_TTL_MS)
    return
  if (persistenceInflightByEnvironment.get(snapshot.environment)?.snapshotVersion === snapshot.snapshotVersion)
    return

  try {
    const token = Symbol('golden-snapshot-persistence')
    const request = Promise.resolve(db.rpc('persist_golden_flag_snapshot', {
        p_environment: snapshot.environment,
        p_snapshot_version: snapshot.snapshotVersion,
        p_snapshot: snapshot,
      }))
      .then(({ data, error }) => {
        const result = Array.isArray(data) ? data[0] : data
        if (!error && result && typeof result === 'object' && (result as { accepted?: unknown }).accepted === true) {
          lastSuccessfulPersistByEnvironment.set(snapshot.environment, {
            snapshotVersion: snapshot.snapshotVersion,
            at: Date.now(),
          })
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (persistenceInflightByEnvironment.get(snapshot.environment)?.token === token) {
          persistenceInflightByEnvironment.delete(snapshot.environment)
        }
      })
    persistenceInflightByEnvironment.set(snapshot.environment, { snapshotVersion: snapshot.snapshotVersion, token })
    void request
  } catch {
    // Missing local configuration and client construction are both non-fatal.
  }
}

async function fetchDurableGoldenSnapshot(
  environment: GoldenFlagEnvironment,
): Promise<FlagSnapshot | undefined> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    const query = Promise.resolve(
      db.from(TABLE).select('snapshot, snapshot_version').eq('environment', environment).maybeSingle(),
    ).catch(() => undefined)
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('golden snapshot mirror fetch timeout')), MIRROR_FETCH_TIMEOUT_MS)
    })
    const result = (await Promise.race([query, timeout])) as {
      data: { snapshot?: unknown; snapshot_version?: unknown } | null
      error: unknown
    } | undefined
    if (!result) return undefined
    const { data, error } = result
    if (error || !data) return undefined
    const snapshot = parseDurableGoldenSnapshot(data.snapshot, environment)
    if (
      !snapshot ||
      typeof data.snapshot_version !== 'number' ||
      !Number.isSafeInteger(data.snapshot_version) ||
      snapshot.snapshotVersion !== data.snapshot_version
    )
      return undefined
    return snapshot
  } catch {
    return undefined
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

/** Returns the last validated database mirror without ever throwing. */
export async function getDurableGoldenSnapshot(): Promise<FlagSnapshot | undefined> {
  const environment = parseGoldenFlagEnvironment(process.env.GOLDEN_BEANS_FLAG_ENVIRONMENT)
  if (!environment) return undefined
  const now = Date.now()
  if (
    cache.environment === environment &&
    cache.fetchedAt !== undefined &&
    now - cache.fetchedAt < MIRROR_CACHE_TTL_MS
  )
    return cache.snapshot
  if (inflight) return inflight

  inflight = fetchDurableGoldenSnapshot(environment)
    .then((snapshot) => {
      // Keep a previously read durable snapshot through a transient database
      // outage. A cold instance with no mirror safely uses compile-time defaults.
      if (snapshot) {
        retainInMemorySnapshot(snapshot)
      } else if (cache.environment !== environment) {
        // Never carry a production mirror into another explicitly configured
        // environment, even if that environment's first database read fails.
        cache.snapshot = undefined
        cache.environment = environment
      }
      cache.fetchedAt = Date.now()
      return cache.snapshot
    })
    .finally(() => {
      inflight = undefined
    })
  return inflight
}
