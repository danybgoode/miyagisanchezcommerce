/**
 * Types for the smoke-sweep runner's pure half, which `e2e/smoke-sweep-manifest.spec.ts`
 * imports to guard the manifest. The runner stays plain `.mjs` — it has to be runnable
 * with bare `node` from a fresh clone, with no build step — so its contract lives here
 * rather than in a `.ts` rewrite.
 */

/** One runnable verification item. Exactly one of `path` / `spec` / `file` is set. */
export interface SmokeSweepEntry {
  id: string
  category: 'A' | 'B' | 'C' | 'D' | 'E' | 'F'
  env: 'prod' | 'local' | 'preview' | 'staging'
  flow: 'unauthed' | 'buyer' | 'seller' | 'admin'
  path?: string
  spec?: string
  file?: string
  /** Names probed once per run; an unmet one marks the entry UNAVAILABLE, never failed. */
  requires?: string[]
  note?: string
}

export interface SmokeSweepManifest {
  description: string
  entries: SmokeSweepEntry[]
  /** requirement name -> what it is. `_` documents the field itself. */
  requirements?: Record<string, string>
  /** spec file -> why it is deliberately not swept. `_` documents the field itself. */
  excluded?: Record<string, string>
}

export interface SmokeSweepFilters {
  categories: string[] | null
  envs: string[] | null
  id: string | null
}

export function loadManifest(): SmokeSweepManifest
export function filterEntries(entries: SmokeSweepEntry[], filters: SmokeSweepFilters): SmokeSweepEntry[]
export function buildArgs(entry: SmokeSweepEntry): string[]
/**
 * Reads only `requires`, so it accepts anything carrying one — the guard spec passes
 * partial fixtures rather than constructing a whole entry to answer a one-field question.
 */
export function decideSellerShopFixture(input: {
  configured?: boolean
  reachable?: boolean
  rowCount?: number
}): { ok: boolean; detail: string }
export function normalizeProbeResult(result: unknown): { ok: boolean; detail: string }
export function unmetRequirements(
  entry: { requires?: string[] } & Record<string, unknown>,
  availability: Map<string, boolean>,
): string[]
