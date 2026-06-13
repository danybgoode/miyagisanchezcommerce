/**
 * Per-category structured-attribute schema — the PDP "specs" primitive.
 *
 * SINGLE SOURCE OF TRUTH for the category attribute field sets. Consumed by:
 *  - seller capture   → app/sell/AttrsSection.tsx (create + edit forms)
 *  - the PDP specs table → app/l/[id]/SpecsTable.tsx (via `listingSpecs`)
 *  - the UCP catalog read → lib/ucp/schema.ts (via `listingSpecs`)
 *
 * Storage: all values live in the generic Medusa `metadata.attrs` bag, which is
 * already round-tripped by the backend create/update/read paths (no new table,
 * no migration). Keys/labels/options below MUST match what the capture form
 * writes — keeping them in one module is what lets the specs table be trusted.
 *
 * Note: the autos/inmuebles *filter* keys the Store API filters on
 * (`metadata.brand/year/km/transmission/fuel`, `rooms/surface/property_type`)
 * are populated by the bulk-import pipeline, NOT by seller capture, which uses
 * the `attrs.*` keys defined here (`make`/`fuel_type`/`area_m2`/`bedrooms`…).
 *
 * Copy is es-MX (the sell flow + PDP are Spanish-only; not bilingual).
 */

import type { Listing } from './types'

export type AttrFieldType = 'text' | 'number' | 'select' | 'date' | 'time'

export interface AttrOption {
  value: string
  label: string
}

export interface AttrField {
  /** Key under `metadata.attrs`. */
  key: string
  /** es-MX capture label (also the specs-row label unless `specLabel` overrides). */
  label: string
  type: AttrFieldType
  /** Allowed values for `type: 'select'` (value = stored slug, label = display). */
  options?: AttrOption[]
  placeholder?: string
  min?: number
  max?: number
  maxLength?: number
  /** Appended after the value in the specs table, e.g. 'km', 'm²'. */
  unit?: string
  /** Apply es-MX thousands grouping to large-magnitude numbers (km, m²). Years/counts stay ungrouped. */
  group?: boolean
  /** Overrides `label` for the specs-table row only (capture keeps `label`). */
  specLabel?: string
}

export interface AttrGroup {
  /** Panel heading shown in the capture form. */
  title: string
  /** Tailwind classes for the capture panel wrapper. */
  panelClass: string
  fields: AttrField[]
}

// Shared option lists ──────────────────────────────────────────────────────────

export const CLOTHING_SIZES = [
  'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'Talla única', 'Otro',
  '4', '6', '8', '10', '12', '14', '16', '18', '20', '22', '24',
  '28', '30', '32', '34', '36', '38', '40', '42', '44',
]

const SIZE_OPTIONS: AttrOption[] = CLOTHING_SIZES.map(s => ({
  value: s.toLowerCase().replace(/\s/g, '_'),
  label: s,
}))

// Category panels (capture + specs) ──────────────────────────────────────────────

/**
 * Paneled categories — rendered as a titled, colored capture panel and used
 * verbatim for the specs table.
 */
export const CATEGORY_GROUPS: Record<string, AttrGroup> = {
  autos: {
    title: 'Características del vehículo',
    panelClass: 'border-amber-200 bg-amber-50/60',
    fields: [
      { key: 'make', label: 'Marca', type: 'text', placeholder: 'Toyota, Honda, VW…' },
      { key: 'model', label: 'Modelo', type: 'text', placeholder: 'Corolla, Civic…' },
      { key: 'year', label: 'Año', type: 'number', placeholder: '2020', min: 1900, max: new Date().getFullYear() + 1 },
      { key: 'km', label: 'Kilómetros', type: 'number', placeholder: '45 000', min: 0, unit: 'km', group: true, specLabel: 'Kilometraje' },
      { key: 'fuel_type', label: 'Combustible', type: 'select', options: [
        { value: 'gasolina', label: 'Gasolina' },
        { value: 'diesel', label: 'Diésel' },
        { value: 'hibrido', label: 'Híbrido' },
        { value: 'electrico', label: 'Eléctrico' },
        { value: 'gas_lp', label: 'Gas LP' },
      ] },
      { key: 'transmission', label: 'Transmisión', type: 'select', options: [
        { value: 'automatico', label: 'Automático' },
        { value: 'manual', label: 'Manual' },
        { value: 'cvt', label: 'CVT' },
      ] },
      { key: 'color', label: 'Color', type: 'text', placeholder: 'Blanco, Rojo…' },
    ],
  },
  inmuebles: {
    title: 'Características del inmueble',
    panelClass: 'border-blue-200 bg-blue-50/60',
    fields: [
      { key: 'property_type', label: 'Tipo', type: 'select', specLabel: 'Tipo de inmueble', options: [
        { value: 'casa', label: 'Casa' },
        { value: 'departamento', label: 'Departamento' },
        { value: 'local', label: 'Local comercial' },
        { value: 'terreno', label: 'Terreno' },
        { value: 'oficina', label: 'Oficina' },
        { value: 'bodega', label: 'Bodega' },
      ] },
      { key: 'area_m2', label: 'Superficie m²', type: 'number', placeholder: '65', min: 1, unit: 'm²', group: true, specLabel: 'Superficie' },
      { key: 'bedrooms', label: 'Recámaras', type: 'number', placeholder: '3', min: 0, max: 20 },
      { key: 'bathrooms', label: 'Baños', type: 'number', placeholder: '2', min: 0, max: 20 },
      { key: 'parking_spots', label: 'Estacionamientos', type: 'number', placeholder: '1', min: 0, max: 10 },
      { key: 'furnished', label: 'Amueblado', type: 'select', options: [
        { value: 'sin_amueblar', label: 'Sin amueblar' },
        { value: 'semi_amueblado', label: 'Semi-amueblado' },
        { value: 'amueblado', label: 'Completamente amueblado' },
      ] },
    ],
  },
  moda: {
    title: 'Características de la prenda',
    panelClass: 'border-pink-200 bg-pink-50/60',
    fields: [
      { key: 'brand', label: 'Marca', type: 'text', placeholder: 'Zara, Nike, H&M…' },
      { key: 'size', label: 'Talla', type: 'select', options: SIZE_OPTIONS },
      { key: 'gender', label: 'Género', type: 'select', options: [
        { value: 'mujer', label: 'Mujer' },
        { value: 'hombre', label: 'Hombre' },
        { value: 'unisex', label: 'Unisex' },
        { value: 'nino', label: 'Niño' },
        { value: 'nina', label: 'Niña' },
        { value: 'bebe', label: 'Bebé' },
      ] },
      { key: 'color', label: 'Color', type: 'text', placeholder: 'Negro, Azul marino…' },
      { key: 'material', label: 'Material', type: 'text', placeholder: 'Algodón, Poliéster…' },
    ],
  },
  electronica: {
    title: 'Características del producto',
    panelClass: 'border-indigo-200 bg-indigo-50/60',
    fields: [
      { key: 'brand', label: 'Marca', type: 'text', placeholder: 'Apple, Samsung, Sony…' },
      { key: 'model', label: 'Modelo', type: 'text', placeholder: 'iPhone 14, Galaxy S24…' },
      { key: 'storage', label: 'Almacenamiento', type: 'text', placeholder: '128 GB, 256 GB…', maxLength: 30 },
      { key: 'color', label: 'Color', type: 'text', placeholder: 'Negro espacial, Blanco…' },
    ],
  },
  servicios: {
    title: 'Detalles del servicio',
    panelClass: 'border-green-200 bg-green-50/60',
    fields: [
      { key: 'modality', label: 'Modalidad', type: 'select', options: [
        { value: 'presencial', label: 'Presencial' },
        { value: 'online', label: 'Online / Remoto' },
        { value: 'domicilio', label: 'A domicilio' },
        { value: 'mixto', label: 'Mixto' },
      ] },
      { key: 'duration', label: 'Duración estimada', type: 'text', placeholder: '1 hora, 2 hrs…', maxLength: 30 },
      { key: 'experience_years', label: 'Años de experiencia', type: 'number', placeholder: '5', min: 0, max: 60, unit: 'años' },
    ],
  },
}

/**
 * Optional event/admission block — shown for digital goods and services that
 * are dated experiences (tickets, classes). Captured but rendered on the PDP by
 * the dedicated event surface, so excluded from the generic specs table.
 */
export const EVENT_FIELDS: AttrField[] = [
  { key: 'event_date', label: 'Fecha', type: 'date' },
  { key: 'event_time', label: 'Hora', type: 'time' },
  { key: 'venue_name', label: 'Recinto', type: 'text', placeholder: 'Foro, teatro, salón…' },
  { key: 'venue_address', label: 'Dirección', type: 'text', placeholder: 'Calle, colonia, ciudad…' },
]

/** Categories that show only a generic brand/color capture (and specs). */
export const GENERIC_CATEGORIES = [
  'hogar', 'herramientas', 'deportes', 'mascotas', 'negocios', 'cursos', 'creatividad', 'comunidad', 'otros',
]

export const GENERIC_FIELDS: AttrField[] = [
  { key: 'brand', label: 'Marca (opcional)', type: 'text', placeholder: 'Marca del producto', specLabel: 'Marca' },
  { key: 'color', label: 'Color (opcional)', type: 'text', placeholder: 'Color principal', specLabel: 'Color' },
]

/**
 * The spec field set for a listing, or [] when nothing applies. MUST mirror the
 * selection logic in app/sell/AttrsSection.tsx (capture & specs must not drift):
 * the capture form keys off BOTH category and listing type — e.g. ANY `service`
 * listing gets the service panel even when its category is `cursos`/`hogar` — so
 * the spec derivation has to use the same inputs or captured values disappear.
 * The event/admission block (digital + dated services) is intentionally excluded
 * — it has its own PDP surface, not the generic specs table.
 */
export function attributeSchema(
  category: string | null | undefined,
  listingType?: string | null,
): AttrField[] {
  if (listingType === 'digital' || listingType === 'subscription') return []
  // Product-paneled categories take precedence over the service fallback.
  if (category && ['autos', 'inmuebles', 'moda', 'electronica'].includes(category)) {
    return CATEGORY_GROUPS[category].fields
  }
  if (category === 'servicios' || listingType === 'service') return CATEGORY_GROUPS.servicios.fields
  if (category && GENERIC_CATEGORIES.includes(category)) return GENERIC_FIELDS
  return []
}

// Specs derivation (PDP table + UCP read) ─────────────────────────────────────────

function isFilled(v: unknown): boolean {
  if (v == null) return false
  if (typeof v === 'string') return v.trim().length > 0
  if (typeof v === 'number') return !Number.isNaN(v)
  return true
}

/** Resolve a stored value to its display string (select label, unit suffix). */
function formatValue(field: AttrField, raw: unknown): string {
  let str: string
  if (field.options) {
    const slug = String(raw)
    str = field.options.find(o => o.value === slug)?.label ?? slug
  } else {
    // Large-magnitude numbers (km, m²) get es-MX thousands grouping; years and
    // counts render plain so a year never shows as "2,020".
    const s = String(raw).trim()
    if (field.type === 'number' && field.group && /^\d+(\.\d+)?$/.test(s)) {
      str = Number(s).toLocaleString('es-MX')
    } else {
      str = s
    }
  }
  return field.unit ? `${str} ${field.unit}` : str
}

export interface Spec {
  label: string
  value: string
}

/**
 * Derive the ordered, labeled specs for a listing from its category schema.
 * Reads the `metadata.attrs` bag (or the typed `attrs` field). Empty/absent
 * values are skipped — a listing with no specs yields [].
 */
export function listingSpecs(
  listing: Pick<Listing, 'category' | 'listing_type' | 'metadata'> & { attrs?: Record<string, unknown> },
): Spec[] {
  const schema = attributeSchema(listing.category, listing.listing_type)
  if (schema.length === 0) return []

  const metadata = (listing.metadata ?? {}) as Record<string, unknown>
  const attrs = (listing.attrs ?? (metadata.attrs as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>

  const specs: Spec[] = []
  for (const field of schema) {
    const raw = attrs[field.key]
    if (!isFilled(raw)) continue
    specs.push({ label: field.specLabel ?? field.label, value: formatValue(field, raw) })
  }
  return specs
}
