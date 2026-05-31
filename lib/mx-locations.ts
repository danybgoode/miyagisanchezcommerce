/**
 * Mexican state + municipio catalog.
 *
 * Envia 2-digit codes are sourced directly from
 *   GET https://geocodes.envia.com/zipcode/MX/{cp}
 * (state.code.2digit field) — every code confirmed via live lookup.
 *
 * INEGI codes follow the standard 2-digit AGEE catalog.
 */

export interface MxEstado {
  /** Full display name — matches MEXICAN_STATES in types.ts */
  name: string
  /** URL-safe slug */
  slug: string
  /** INEGI 2-digit code, zero-padded ("09") */
  inegi_code: string
  /** Envia.com 2-digit state code ("CX") — use when building EnviaAddress */
  envia_code: string
}

export const ESTADOS: MxEstado[] = [
  { name: 'Aguascalientes',    slug: 'aguascalientes',    inegi_code: '01', envia_code: 'AG' },
  { name: 'Baja California',   slug: 'baja-california',   inegi_code: '02', envia_code: 'BC' },
  { name: 'Baja California Sur', slug: 'baja-california-sur', inegi_code: '03', envia_code: 'BS' },
  { name: 'Campeche',          slug: 'campeche',          inegi_code: '04', envia_code: 'CM' },
  { name: 'Chiapas',           slug: 'chiapas',           inegi_code: '07', envia_code: 'CS' },
  { name: 'Chihuahua',         slug: 'chihuahua',         inegi_code: '08', envia_code: 'CH' },
  { name: 'Ciudad de México',  slug: 'ciudad-de-mexico',  inegi_code: '09', envia_code: 'CX' },
  { name: 'Coahuila',          slug: 'coahuila',          inegi_code: '05', envia_code: 'CO' },
  { name: 'Colima',            slug: 'colima',            inegi_code: '06', envia_code: 'CL' },
  { name: 'Durango',           slug: 'durango',           inegi_code: '10', envia_code: 'DG' },
  { name: 'Estado de México',  slug: 'estado-de-mexico',  inegi_code: '15', envia_code: 'EM' },
  { name: 'Guanajuato',        slug: 'guanajuato',        inegi_code: '11', envia_code: 'GT' },
  { name: 'Guerrero',          slug: 'guerrero',          inegi_code: '12', envia_code: 'GR' },
  { name: 'Hidalgo',           slug: 'hidalgo',           inegi_code: '13', envia_code: 'HG' },
  { name: 'Jalisco',           slug: 'jalisco',           inegi_code: '14', envia_code: 'JA' },
  { name: 'Michoacán',         slug: 'michoacan',         inegi_code: '16', envia_code: 'MI' },
  { name: 'Morelos',           slug: 'morelos',           inegi_code: '17', envia_code: 'MO' },
  { name: 'Nayarit',           slug: 'nayarit',           inegi_code: '18', envia_code: 'NA' },
  { name: 'Nuevo León',        slug: 'nuevo-leon',        inegi_code: '19', envia_code: 'NL' },
  { name: 'Oaxaca',            slug: 'oaxaca',            inegi_code: '20', envia_code: 'OA' },
  { name: 'Puebla',            slug: 'puebla',            inegi_code: '21', envia_code: 'PU' },
  { name: 'Querétaro',         slug: 'queretaro',         inegi_code: '22', envia_code: 'QT' },
  { name: 'Quintana Roo',      slug: 'quintana-roo',      inegi_code: '23', envia_code: 'QR' },
  { name: 'San Luis Potosí',   slug: 'san-luis-potosi',   inegi_code: '24', envia_code: 'SL' },
  { name: 'Sinaloa',           slug: 'sinaloa',           inegi_code: '25', envia_code: 'SI' },
  { name: 'Sonora',            slug: 'sonora',            inegi_code: '26', envia_code: 'SO' },
  { name: 'Tabasco',           slug: 'tabasco',           inegi_code: '27', envia_code: 'TB' },
  { name: 'Tamaulipas',        slug: 'tamaulipas',        inegi_code: '28', envia_code: 'TM' },
  { name: 'Tlaxcala',          slug: 'tlaxcala',          inegi_code: '29', envia_code: 'TL' },
  { name: 'Veracruz',          slug: 'veracruz',          inegi_code: '30', envia_code: 'VE' },
  { name: 'Yucatán',           slug: 'yucatan',           inegi_code: '31', envia_code: 'YU' },
  { name: 'Zacatecas',         slug: 'zacatecas',         inegi_code: '32', envia_code: 'ZA' },
]

/** INEGI codes keyed by display name — for product metadata storage */
export const ESTADO_INEGI_BY_NAME: Record<string, string> = Object.fromEntries(
  ESTADOS.map(e => [e.name, e.inegi_code])
)

/** Envia 2-digit codes keyed by display name */
export const ENVIA_CODE_BY_NAME: Record<string, string> = Object.fromEntries(
  ESTADOS.map(e => [e.name, e.envia_code])
)

/** Envia 2-digit codes keyed by slug */
const ENVIA_CODE_BY_SLUG: Record<string, string> = Object.fromEntries(
  ESTADOS.map(e => [e.slug, e.envia_code])
)

/** INEGI code → full estado, for display at render time */
export const ESTADO_BY_INEGI: Record<string, MxEstado> = Object.fromEntries(
  ESTADOS.map(e => [e.inegi_code, e])
)

/**
 * Returns the Envia 2-digit state code for any state identifier.
 * Accepts: display name ("Ciudad de México"), slug ("ciudad-de-mexico"),
 *          or a code that's already correct ("CX", "NL").
 * Returns the input unchanged if no match is found (graceful fallback).
 */
export function toEnviaStateCode(input: string): string {
  if (!input) return input
  const trimmed = input.trim()

  // Already a valid Envia code
  if (ENVIA_CODE_BY_NAME[trimmed]) return ENVIA_CODE_BY_NAME[trimmed]

  // Try case-insensitive name match
  const byNameCI = ESTADOS.find(e => e.name.toLowerCase() === trimmed.toLowerCase())
  if (byNameCI) return byNameCI.envia_code

  // Try slug
  const slug = trimmed.toLowerCase().replace(/\s+/g, '-').normalize('NFD').replace(/[̀-ͯ]/g, '')
  if (ENVIA_CODE_BY_SLUG[slug]) return ENVIA_CODE_BY_SLUG[slug]

  // Already looks like a code (2-4 uppercase chars) — return as-is
  if (/^[A-Z]{2,4}$/.test(trimmed)) return trimmed

  // Unknown — return as-is and let Envia's validation catch it
  return trimmed
}

/**
 * Returns the display name for a given INEGI estado code.
 * Falls back to the stored string if the code isn't found.
 */
export function estadoDisplayName(inegiCode: string): string {
  return ESTADO_BY_INEGI[inegiCode]?.name ?? inegiCode
}

/** Sorted display names — use for <select> dropdowns */
export const ESTADO_NAMES: string[] = ESTADOS.map(e => e.name)
