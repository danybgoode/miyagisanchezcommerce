/**
 * Printed-Edition Builder — layout document types + pure helpers (Phase 4).
 *
 * The layout is editorial state stored in Supabase (print_layouts), NOT commerce.
 * A page holds ad blocks; each block carries a CONTENT SNAPSHOT (so the layout is
 * reproducible) plus a `source.ref_id` back to its origin (a paid submission today;
 * a live listing/shop in Sprint 2) so it can be re-pulled. See print-layout-server.ts
 * for load/save and the migration 20260603000000_print_layouts.sql for storage.
 */

import type { PrintAdContent, PrintAdSubmission, PrintTierKey } from '@/lib/print'

// ── Paper / grid ──────────────────────────────────────────────────────────────

export type PrintPageSize = 'carta' | 'media_carta'
/** Page density: 4-grid (2×2 quarters) or 8-grid (2×4 eighths). */
export type PrintDensity = 4 | 8

/** Physical trim dimensions (mm) per preset — consumed by the print view (US-5a). */
export const PRINT_PAGE_DIMS: Record<PrintPageSize, { label: string; w_mm: number; h_mm: number }> = {
  carta:       { label: 'Carta (21.59 × 27.94 cm)',      w_mm: 215.9, h_mm: 279.4 },
  media_carta: { label: 'Media carta (13.97 × 21.59 cm)', w_mm: 139.7, h_mm: 215.9 },
}

/** Rows in the page grid for a density (grid is always 2 columns). */
export function densityRows(density: PrintDensity): number {
  return density === 8 ? 4 : 2
}

// ── Block ───────────────────────────────────────────────────────────────────

export type PrintBlockSourceType = 'submission' | 'listing' | 'shop' | 'social' | 'custom'
export interface PrintBlockSource {
  type: PrintBlockSourceType
  /** submission id · product id · seller id · social id (null for custom/editorial). */
  ref_id?: string | null
}

/** 'ad' = product/placement tile; the rest are editorial inserts (US-2). */
export type PrintBlockKind = 'ad' | 'cover' | 'section' | 'filler'

export type PrintBorderStyle = 'thick' | 'dotted' | 'double' | 'none'
export type PrintTextSize = 'xs' | 'sm' | 'base' | 'lg'

export interface PrintBlockStyle {
  /** Hex from the curated retro palette (US-3). */
  bg?: string | null
  border?: PrintBorderStyle
  text_size?: PrintTextSize
  /** Field keys hidden in this block, e.g. ['body','price','subhead']. */
  hidden_fields?: string[]
}

/** Block content snapshot — superset of a submission's ad content. */
export interface PrintBlockContent extends PrintAdContent {
  title?: string | null
  price?: string | null
  /** Heading text for section/filler editorial blocks. */
  label?: string | null
}

/** Footprint in grid units: col-span (1 or 2 of 2 columns), row-span (1..rows). */
export interface PrintBlockSpan {
  col: 1 | 2
  row: 1 | 2
}

/** The four modular footprints (México-86 classifieds): quarter, half-wide, half-tall, full. */
export type PrintSpanKey = 'quarter' | 'half_h' | 'half_v' | 'full'
export const PRINT_SPAN_PRESETS: Record<PrintSpanKey, { label: string; span: PrintBlockSpan }> = {
  quarter: { label: '¼ caja',   span: { col: 1, row: 1 } },
  half_h:  { label: '½ ancho',  span: { col: 2, row: 1 } },
  half_v:  { label: '½ alto',   span: { col: 1, row: 2 } },
  full:    { label: 'Plana',    span: { col: 2, row: 2 } },
}

export function spanKeyOf(span: PrintBlockSpan): PrintSpanKey {
  if (span.col === 2 && span.row === 2) return 'full'
  if (span.col === 2) return 'half_h'
  if (span.row === 2) return 'half_v'
  return 'quarter'
}

/** Visual scale of a block, from its footprint area and the page density. Drives
 *  auto-sizing — a single cell in an 8-grid is 'micro' (hide body, tiny type). */
export type PrintBlockSize = 'micro' | 'small' | 'medium' | 'large'
export function blockSize(density: PrintDensity, span: PrintBlockSpan): PrintBlockSize {
  const area = span.col * span.row
  if (area >= 4) return 'large'
  if (area === 2) return 'medium'
  return density === 8 ? 'micro' : 'small'
}

export interface PrintBlock {
  id: string
  kind: PrintBlockKind
  source: PrintBlockSource
  span: PrintBlockSpan
  content: PrintBlockContent
  style: PrintBlockStyle
  tier_key?: PrintTierKey | null
}

// ── Page / document ───────────────────────────────────────────────────────────

export interface PrintPage {
  id: string
  kind: 'grid' | 'cover' | 'editorial'
  density: PrintDensity
  blocks: PrintBlock[]
}

export interface PrintLayoutDocument {
  version: 1
  density_default: PrintDensity
  pages: PrintPage[]
}

/** Full row shape returned by the layout API. */
export interface PrintLayout {
  edition_id: string
  page_size: PrintPageSize
  document: PrintLayoutDocument
  locked_at: string | null
  updated_at: string | null
}

// ── Pure helpers (client + server) ─────────────────────────────────────────────

function uid(): string {
  return (globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`)
}

export function newPage(density: PrintDensity, kind: PrintPage['kind'] = 'grid'): PrintPage {
  return { id: uid(), kind, density, blocks: [] }
}

export function emptyDocument(density: PrintDensity = 4): PrintLayoutDocument {
  return { version: 1, density_default: density, pages: [newPage(density)] }
}

/** Map a paid ad submission to a quarter-size ad block (the builder's default tile). */
export function submissionToBlock(sub: Pick<PrintAdSubmission, 'id' | 'tier_key' | 'content'>): PrintBlock {
  return {
    id: uid(),
    kind: 'ad',
    source: { type: 'submission', ref_id: sub.id },
    span: { col: 1, row: 1 },
    content: { ...(sub.content ?? {}) },
    style: {},
    tier_key: sub.tier_key ?? null,
  }
}

/** Submission ids already placed anywhere in the document (to filter the tray). */
export function placedSubmissionIds(doc: PrintLayoutDocument): Set<string> {
  const ids = new Set<string>()
  for (const page of doc.pages ?? []) {
    for (const b of page.blocks ?? []) {
      if (b.source.type === 'submission' && b.source.ref_id) ids.add(b.source.ref_id)
    }
  }
  return ids
}

export { uid as newId }
