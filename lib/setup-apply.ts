/**
 * Agent-native setup (Onboarding 0) — Sprint 2: the pure first-run APPLY seam.
 *
 * The orchestration that turns ONE validated setup file (see lib/setup-spec.ts)
 * into the three calls that already exist, plus the fold of their responses into
 * a single per-block / per-row report. Both halves are pure + framework-agnostic
 * (no React, no next/cache, no fetch) so the client orchestrator AND the
 * Playwright `api` runner import the exact same logic — "test the seam".
 *
 * The actual mutation is NOT here: the client walks this plan over the existing
 * routes (POST /api/sell/shop → /api/sell/settings-import → /api/sell/import),
 * which keep all their auth, validation, idempotency, and graceful-degrade
 * behavior unchanged. This module only decides *what* to send and *how to count
 * what came back*.
 */

import { MAX_IMPORT_ROWS, type CatalogImportRow } from './catalog-import'
import { type StoreConfigManifest, type BlockResult } from './settings-import'
import { type MiyagiSetupFile } from './setup-spec'

/** Rows per /api/sell/import request. MUST match CHUNK_MAX in that route. */
export const IMPORT_CHUNK_SIZE = 25

// ── The shop-create payload (subset of POST /api/sell/shop's body) ───────────────

export interface ShopCreatePayload {
  name?: string
  slug?: string
  description?: string
  state?: string
  city?: string
}

// ── The per-row import result (mirrors RowResult in /api/sell/import) ─────────────

export interface RowResult {
  line: number
  title: string
  status: 'created' | 'updated' | 'failed'
  product_id?: string
  reason?: string
  images_failed?: number
}

// ── The plan ─────────────────────────────────────────────────────────────────────

export interface SetupApplyPlan {
  /** Always present — POST /api/sell/shop is idempotent, so we always call it and
   *  read 201 (created) vs 200 (existed). Name may be empty (route fills from Clerk). */
  shop: ShopCreatePayload
  /** The config manifest to POST to /api/sell/settings-import, or null when absent. */
  configManifest: StoreConfigManifest | null
  /** The catalog split into ≤IMPORT_CHUNK_SIZE batches (capped at MAX_IMPORT_ROWS). */
  catalogChunks: CatalogImportRow[][]
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/**
 * Build the deterministic apply plan from a (already version-checked) setup file.
 * Pure — no I/O. The shop identity is taken from `profile`, falling back to the
 * config's own profile block; an absent name is fine (the route derives one).
 */
export function planSetupApply(file: MiyagiSetupFile): SetupApplyPlan {
  const profile = file.profile ?? file.config?.profile ?? {}

  const shop: ShopCreatePayload = {
    name: profile.name?.trim() || undefined,
    description: profile.description?.trim() || undefined,
    state: profile.state?.trim() || undefined,
    city: profile.city?.trim() || undefined,
  }

  const hasConfigBlocks = !!file.config && Object.keys(file.config).length > 0
  const configManifest = hasConfigBlocks ? (file.config as StoreConfigManifest) : null

  const catalog = Array.isArray(file.catalog) ? file.catalog.slice(0, MAX_IMPORT_ROWS) : []
  const catalogChunks = chunk(catalog, IMPORT_CHUNK_SIZE)

  return { shop, configManifest, catalogChunks }
}

// ── The report ───────────────────────────────────────────────────────────────────

export interface SetupApplyReport {
  shop: 'created' | 'existed' | 'failed'
  shopSlug: string | null
  /** Per-block config delta (empty when no config was sent). */
  config: BlockResult[]
  catalog: {
    created: number
    updated: number
    failed: number
    rows: RowResult[]
  }
}

/** The raw responses the client collects while walking the plan. */
export interface SetupApplyParts {
  shop: { ok: boolean; status: number; shopSlug?: string | null }
  /** null when the plan carried no config manifest. */
  config: { ok: boolean; blocks?: BlockResult[] } | null
  /** One entry per chunk request. A chunk that failed at the HTTP level should
   *  still pass a `results` array (use `chunkFailureRows`) so counts stay honest. */
  catalogChunks: Array<{ results?: RowResult[] }>
}

/**
 * Fold the three call results into one delta. Pure — never throws on a partial
 * failure (a failed config block or import chunk just shows up in the report).
 * Idempotent re-apply surfaces naturally: shop 200 → 'existed', rows → 'updated'.
 */
export function aggregateSetupReport(parts: SetupApplyParts): SetupApplyReport {
  const shop =
    parts.shop.status === 201 ? 'created'
    : parts.shop.status === 200 ? 'existed'
    : 'failed'

  const config = parts.config?.blocks ?? []

  const rows: RowResult[] = []
  for (const c of parts.catalogChunks) {
    if (Array.isArray(c.results)) rows.push(...c.results)
  }
  const created = rows.filter((r) => r.status === 'created').length
  const updated = rows.filter((r) => r.status === 'updated').length
  const failed = rows.filter((r) => r.status === 'failed').length

  return {
    shop,
    shopSlug: parts.shop.shopSlug ?? null,
    config,
    catalog: { created, updated, failed, rows },
  }
}

/**
 * Synthesize per-row `failed` results for a chunk request that didn't return a
 * `results` array (HTTP error, 404 no-shop, network). Keeps the aggregate honest
 * — every catalog row the user staged is accounted for in the final report.
 */
export function chunkFailureRows(
  rows: CatalogImportRow[],
  startLine: number,
  reason: string,
): RowResult[] {
  return rows.map((row, i) => ({
    line: startLine + i,
    title: (row.title || '(sin título)').slice(0, 80),
    status: 'failed' as const,
    reason,
  }))
}
