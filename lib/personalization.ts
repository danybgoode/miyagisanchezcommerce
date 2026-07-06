/**
 * Configurable & Personalized Products — shared data model + helpers.
 *
 * One definition of what a "custom field" is, used at every stage so config, the
 * buy box, the cart, checkout, the order screens and the emails all read and
 * validate the buyer's personalization the same way.
 *
 *  - DEFINITION (seller-authored) lives on the Medusa **product** metadata:
 *      product.metadata.custom_fields: CustomFieldDef[]
 *  - PAYLOAD (buyer-entered) rides the Medusa **line item** metadata:
 *      line_item.metadata.personalization: PersonalizationPayload
 *    → which flows natively into the order line item.
 *
 * No new tables — everything is Medusa-native metadata (AGENTS rule #1).
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type CustomFieldType = 'short_text' | 'long_text' | 'select' | 'file'

/** Artwork formats a buyer may upload for a `file` field — real magic-byte
 *  sniffing enforces this server-side (`lib/file-sniff.ts`), never just the
 *  client-declared extension/Content-Type. */
export const ARTWORK_FORMATS = ['png', 'jpg', 'pdf', 'ai', 'svg'] as const
export type ArtworkFormat = typeof ARTWORK_FORMATS[number]

/**
 * Hard server ceiling for an artwork upload, regardless of what a seller
 * sets. Capped well under Vercel's documented 4.5MB request-body limit for
 * Node.js Serverless Functions (this route can't run on the Edge runtime —
 * it needs Buffer/aws-sdk for the R2 upload) — verified live against a real
 * dev server: a request body approaching that range fails to even parse
 * (`req.formData()` throws) before this app-level check ever runs, so the
 * ceiling must leave real headroom, not just look reasonable on paper.
 */
export const MAX_ARTWORK_SIZE_MB = 4

export interface CustomFieldDef {
  /** Stable id; also the key the buyer's value is stored under. */
  id: string
  type: CustomFieldType
  /** Seller-authored label shown above the input (free text, their language). */
  label: string
  /** Seller-authored placeholder / guidance. */
  placeholder?: string
  /** Max characters for text fields (clamped to the type cap). */
  max_length?: number
  required: boolean
  /** Choices for `select` only. */
  options?: string[]
  /** Allowed upload formats for `file` only — defaults to all of `ARTWORK_FORMATS`. */
  allowed_formats?: ArtworkFormat[]
  /** Max upload size in MB for `file` only — clamped to `[1, MAX_ARTWORK_SIZE_MB]`. */
  max_size_mb?: number
}

/**
 * A single answered field, denormalised so downstream stages need no defs.
 * `type` is optional (older orders predate it) — a reader that skips it just
 * treats the value as plain text, which is always safe. For a `file` field,
 * `value` IS the uploaded artwork's public R2 URL — never character-clamped
 * like a text answer (see `buildPersonalizationPayload`).
 */
export interface PersonalizationField {
  id: string
  label: string
  value: string
  type?: CustomFieldType
}

export interface PersonalizationPayload {
  fields: PersonalizationField[]
}

// ── Limits ────────────────────────────────────────────────────────────────────

export const CUSTOM_FIELD_TYPES: readonly CustomFieldType[] = ['short_text', 'long_text', 'select', 'file']
export const MAX_CUSTOM_FIELDS = 10
export const SHORT_TEXT_LIMIT = 80
export const LONG_TEXT_LIMIT = 500
const MAX_LABEL = 60
const MAX_PLACEHOLDER = 100
const MAX_OPTION_LABEL = 60
const MAX_OPTIONS = 20

/**
 * The hard character cap for a field, before applying a seller's `max_length`.
 * `file`/`select` values aren't character-clamped at all (a URL, or a fixed
 * choice) — this only matters for a caller that goes through
 * `effectiveMaxLength` directly; `buildPersonalizationPayload` also
 * special-cases both types below so a long R2 URL is never truncated.
 */
export function typeCap(type: CustomFieldType): number {
  if (type === 'long_text') return LONG_TEXT_LIMIT
  if (type === 'file') return Infinity
  return SHORT_TEXT_LIMIT
}

/** The effective max characters a buyer may type into a field. */
export function effectiveMaxLength(def: CustomFieldDef): number {
  const cap = typeCap(def.type)
  if (def.max_length && def.max_length > 0) return Math.min(def.max_length, cap)
  return cap
}

// ── ID generation ───────────────────────────────────────────────────────────

let idCounter = 0
function newFieldId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `cf_${crypto.randomUUID().slice(0, 8)}`
    }
  } catch { /* fall through */ }
  idCounter += 1
  return `cf_${Date.now().toString(36)}${idCounter.toString(36)}`
}

// ── Sanitisation (defs) ───────────────────────────────────────────────────────

function clampStr(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

/**
 * Validate + normalise raw custom-field definitions coming from the seller UI or
 * an API caller. Drops malformed entries, clamps lengths, caps the count, and
 * guarantees a stable id on each. Never throws — returns a clean array.
 */
export function sanitizeFieldDefs(raw: unknown): CustomFieldDef[] {
  if (!Array.isArray(raw)) return []
  const out: CustomFieldDef[] = []
  const seenIds = new Set<string>()

  for (const entry of raw) {
    if (out.length >= MAX_CUSTOM_FIELDS) break
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>

    const type = CUSTOM_FIELD_TYPES.includes(e.type as CustomFieldType)
      ? (e.type as CustomFieldType)
      : 'short_text'

    const label = clampStr(e.label, MAX_LABEL)
    if (!label) continue // a field with no label is meaningless

    let id = clampStr(e.id, 40)
    if (!id || seenIds.has(id)) id = newFieldId()
    seenIds.add(id)

    const def: CustomFieldDef = {
      id,
      type,
      label,
      required: e.required === true,
    }

    const placeholder = clampStr(e.placeholder, MAX_PLACEHOLDER)
    if (placeholder) def.placeholder = placeholder

    if (type === 'select') {
      const options = Array.isArray(e.options)
        ? e.options
            .map(o => clampStr(o, MAX_OPTION_LABEL))
            .filter((o, i, arr) => o && arr.indexOf(o) === i)
            .slice(0, MAX_OPTIONS)
        : []
      // A select with no options can't be answered — drop it.
      if (options.length === 0) continue
      def.options = options
    } else if (type === 'file') {
      const formats = Array.isArray(e.allowed_formats)
        ? (e.allowed_formats as unknown[]).filter((f): f is ArtworkFormat =>
            ARTWORK_FORMATS.includes(f as ArtworkFormat))
        : []
      // Empty/invalid allowlist → default to all formats, so a required file
      // field is never impossible for a buyer to satisfy.
      def.allowed_formats = formats.length > 0 ? formats : [...ARTWORK_FORMATS]

      const sizeMb = Number(e.max_size_mb)
      def.max_size_mb = Number.isFinite(sizeMb) && sizeMb > 0
        ? Math.min(Math.floor(sizeMb), MAX_ARTWORK_SIZE_MB)
        : MAX_ARTWORK_SIZE_MB
    } else {
      const cap = typeCap(type)
      const ml = Number(e.max_length)
      if (Number.isFinite(ml) && ml > 0) def.max_length = Math.min(Math.floor(ml), cap)
    }

    out.push(def)
  }

  return out
}

/** Make a fresh, valid empty definition for the seller UI to edit. */
export function emptyFieldDef(type: CustomFieldType = 'short_text'): CustomFieldDef {
  return { id: newFieldId(), type, label: '', required: false, ...(type === 'select' ? { options: [] } : {}) }
}

// ── Reading defs off a listing ────────────────────────────────────────────────

/** Pull sanitised custom-field defs from a listing/product metadata blob. */
export function getCustomFields(metadata: Record<string, unknown> | null | undefined): CustomFieldDef[] {
  if (!metadata) return []
  return sanitizeFieldDefs((metadata as Record<string, unknown>).custom_fields)
}

// ── Validation + payload build (buyer side) ───────────────────────────────────

export interface PersonalizationValidation {
  ok: boolean
  /** First required field left blank, if any — focus target for the UI. */
  missingFieldId?: string
}

/** A required field is satisfied when its trimmed value is non-empty. */
export function validatePersonalization(
  defs: CustomFieldDef[],
  values: Record<string, string>,
): PersonalizationValidation {
  for (const def of defs) {
    if (def.required && !(values[def.id] ?? '').trim()) {
      return { ok: false, missingFieldId: def.id }
    }
  }
  return { ok: true }
}

/**
 * Build the structured, denormalised payload for the line item. Drops empty
 * answers, clamps each value to its field's effective max, and keeps the
 * seller's label alongside the value so every downstream stage is self-contained.
 * `select` and `file` values are never character-clamped — a `file` value is
 * an R2 URL, and truncating it would silently produce a broken link.
 */
export function buildPersonalizationPayload(
  defs: CustomFieldDef[],
  values: Record<string, string>,
): PersonalizationPayload | null {
  const fields: PersonalizationField[] = []
  for (const def of defs) {
    const raw = (values[def.id] ?? '').trim()
    if (!raw) continue
    const value = def.type === 'select' || def.type === 'file' ? raw : raw.slice(0, effectiveMaxLength(def))
    fields.push({ id: def.id, label: def.label, value, type: def.type })
  }
  return fields.length > 0 ? { fields } : null
}

/**
 * Narrow an unknown metadata value into a PersonalizationPayload, or null.
 * `type` is validated against the known `CustomFieldType`s (never trusted
 * as an arbitrary string) — line-item metadata is technically buyer/API-
 * writable via some paths, and a render site branches on `type === 'file'`
 * to decide whether to put a value into an `<img src>`/`<a href>`.
 */
export function readPersonalization(value: unknown): PersonalizationPayload | null {
  if (!value || typeof value !== 'object') return null
  const fields = (value as Record<string, unknown>).fields
  if (!Array.isArray(fields)) return null
  const clean: PersonalizationField[] = []
  for (const f of fields) {
    if (!f || typeof f !== 'object') continue
    const ff = f as Record<string, unknown>
    const label = typeof ff.label === 'string' ? ff.label : ''
    const val = typeof ff.value === 'string' ? ff.value : ''
    if (!val.trim()) continue
    const type = CUSTOM_FIELD_TYPES.includes(ff.type as CustomFieldType) ? (ff.type as CustomFieldType) : undefined
    clean.push({ id: typeof ff.id === 'string' ? ff.id : '', label, value: val, ...(type ? { type } : {}) })
  }
  return clean.length > 0 ? { fields: clean } : null
}

/** Render a payload as plain "Label: value" lines — reused by cart, checkout,
 *  order screens and emails so the formatting never drifts. */
export function formatPersonalizationLines(payload: PersonalizationPayload | null | undefined): string[] {
  if (!payload?.fields?.length) return []
  return payload.fields.map(f => (f.label ? `${f.label}: ${f.value}` : f.value))
}

// ── Buy-now hand-off (sessionStorage) ─────────────────────────────────────────
// The PDP buy-now CTA navigates to /checkout (it doesn't call startCheckout
// itself), so the payload is stashed under a per-listing key the checkout page
// reads back. sessionStorage (not local) — it's a single in-flight purchase.

export function personalizationStorageKey(listingId: string): string {
  return `ms_personalization_${listingId}`
}

export function stashPersonalization(listingId: string, payload: PersonalizationPayload | null): void {
  try {
    const key = personalizationStorageKey(listingId)
    if (payload) sessionStorage.setItem(key, JSON.stringify(payload))
    else sessionStorage.removeItem(key)
  } catch { /* storage unavailable — non-fatal */ }
}

export function readStashedPersonalization(listingId: string): PersonalizationPayload | null {
  try {
    const raw = sessionStorage.getItem(personalizationStorageKey(listingId))
    return raw ? readPersonalization(JSON.parse(raw)) : null
  } catch { return null }
}

// ── Order line items → per-item personalization blocks ────────────────────────
// Used by webhooks / finalize to feed the order emails directly from a Medusa
// order's line items (each carries metadata.personalization).

export interface PersonalizationBlock {
  title?: string
  fields: PersonalizationField[]
}

export function personalizationFromOrderItems(
  items: Array<{ title?: string; metadata?: { personalization?: unknown } | null }> | null | undefined,
): PersonalizationBlock[] {
  if (!Array.isArray(items)) return []
  const blocks: PersonalizationBlock[] = []
  for (const it of items) {
    const payload = readPersonalization(it?.metadata?.personalization)
    if (payload) blocks.push({ title: it?.title, fields: payload.fields })
  }
  return blocks
}

// ── Labels (es-MX UI chrome) ──────────────────────────────────────────────────

export const FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  short_text: 'Texto corto',
  long_text: 'Texto largo',
  select: 'Lista de opciones',
  file: 'Arte / archivo',
}

// ── Artwork low-res preflight (warn, never block) ──────────────────────────────

export interface ArtworkResolutionCheck {
  warn: boolean
  message?: string
}

/**
 * Warn (never block) when an uploaded raster image is too low-res for the
 * physical size it'll be printed at, at a target print quality of ~300 PPI.
 * Only meaningful for raster formats with known pixel dimensions and a known
 * physical size — an unparseable/unknown input silently skips the check
 * (never confuse the buyer with a warning that doesn't actually apply).
 */
export function checkArtworkResolution({
  pixelWidth,
  pixelHeight,
  physicalCm,
  ppi = 300,
}: {
  pixelWidth?: number | null
  pixelHeight?: number | null
  physicalCm?: number | null
  ppi?: number
}): ArtworkResolutionCheck {
  if (!pixelWidth || !pixelHeight || !physicalCm || pixelWidth <= 0 || pixelHeight <= 0 || physicalCm <= 0) {
    return { warn: false }
  }
  const physicalInches = physicalCm / 2.54
  const requiredPixels = physicalInches * ppi
  const shortestSide = Math.min(pixelWidth, pixelHeight)
  if (shortestSide >= requiredPixels) return { warn: false }
  return {
    warn: true,
    message: `Tu imagen tiene resolución baja para el tamaño elegido (${physicalCm}cm) — puede verse borrosa al imprimir.`,
  }
}

/**
 * Best-effort extraction of a physical size in cm from a seller-authored
 * dimension value like "10cm", "10 cm", "10 × 15 cm" (the number immediately
 * before "cm" wins, e.g. 15 for "10 × 15 cm" — good enough for a warn-only
 * heuristic, not a precise multi-dimension parse). Returns null when
 * unparseable, so the caller can silently skip the preflight rather than guess.
 */
export function parseSizeCm(dimensionValue: string | null | undefined): number | null {
  if (!dimensionValue) return null
  const match = dimensionValue.match(/(\d+(?:\.\d+)?)\s*cm/i)
  if (!match) return null
  const n = parseFloat(match[1])
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Resolve the buy-box CTA labels. A personalizable product normally reads
 * "Comprar ahora — $precio"; when it's *also* an event (which already computes
 * its own "Comprar boleto — $precio" labels upstream), the caller passes an
 * override so the CTA matches the event framing above it. Absent an override,
 * returns the unchanged default strings (S1.2).
 */
export function personalizationBuyLabels(
  priceLabel: string,
  override?: { buyNowLabel?: string; signInBuyLabel?: string },
): { buyNow: string; signIn: string } {
  return {
    buyNow: override?.buyNowLabel ?? `Comprar ahora — ${priceLabel}`,
    signIn: override?.signInBuyLabel ?? 'Inicia sesión para comprar',
  }
}
