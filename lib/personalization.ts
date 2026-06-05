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

export type CustomFieldType = 'short_text' | 'long_text' | 'select'

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
}

/** A single answered field, denormalised so downstream stages need no defs. */
export interface PersonalizationField {
  id: string
  label: string
  value: string
}

export interface PersonalizationPayload {
  fields: PersonalizationField[]
}

// ── Limits ────────────────────────────────────────────────────────────────────

export const CUSTOM_FIELD_TYPES: readonly CustomFieldType[] = ['short_text', 'long_text', 'select']
export const MAX_CUSTOM_FIELDS = 10
export const SHORT_TEXT_LIMIT = 80
export const LONG_TEXT_LIMIT = 500
const MAX_LABEL = 60
const MAX_PLACEHOLDER = 100
const MAX_OPTION_LABEL = 60
const MAX_OPTIONS = 20

/** The hard character cap for a field, before applying a seller's `max_length`. */
export function typeCap(type: CustomFieldType): number {
  return type === 'long_text' ? LONG_TEXT_LIMIT : SHORT_TEXT_LIMIT
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

    if (type !== 'select') {
      const cap = typeCap(type)
      const ml = Number(e.max_length)
      if (Number.isFinite(ml) && ml > 0) def.max_length = Math.min(Math.floor(ml), cap)
    } else {
      const options = Array.isArray(e.options)
        ? e.options
            .map(o => clampStr(o, MAX_OPTION_LABEL))
            .filter((o, i, arr) => o && arr.indexOf(o) === i)
            .slice(0, MAX_OPTIONS)
        : []
      // A select with no options can't be answered — drop it.
      if (options.length === 0) continue
      def.options = options
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
 */
export function buildPersonalizationPayload(
  defs: CustomFieldDef[],
  values: Record<string, string>,
): PersonalizationPayload | null {
  const fields: PersonalizationField[] = []
  for (const def of defs) {
    const raw = (values[def.id] ?? '').trim()
    if (!raw) continue
    const value = def.type === 'select' ? raw : raw.slice(0, effectiveMaxLength(def))
    fields.push({ id: def.id, label: def.label, value })
  }
  return fields.length > 0 ? { fields } : null
}

/** Narrow an unknown metadata value into a PersonalizationPayload, or null. */
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
    if (!val) continue
    clean.push({ id: typeof ff.id === 'string' ? ff.id : '', label, value: val })
  }
  return clean.length > 0 ? { fields: clean } : null
}

/** Render a payload as plain "Label: value" lines — reused by cart, checkout,
 *  order screens and emails so the formatting never drifts. */
export function formatPersonalizationLines(payload: PersonalizationPayload | null | undefined): string[] {
  if (!payload?.fields?.length) return []
  return payload.fields.map(f => (f.label ? `${f.label}: ${f.value}` : f.value))
}

// ── Labels (es-MX UI chrome) ──────────────────────────────────────────────────

export const FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  short_text: 'Texto corto',
  long_text: 'Texto largo',
  select: 'Lista de opciones',
}
