/**
 * lib/bilingual-namespaces.ts
 *
 * AGENTS.md rule #5: es-MX is the default; a DEFINED allow-list of surfaces is
 * genuinely bilingual. `locales/es.json` / `locales/en.json` carry the same
 * top-level namespaces with identical key shapes, but that's an artifact of the
 * dictionary file, not a bilingual surface — most namespaces are read with a
 * hardcoded `'es'` locale and never expose the `en` copy to anyone.
 *
 * Today's genuinely bilingual namespaces (confirmed 2026-07-08 by reading every
 * `getDictionary()` call site): `terms` (`app/(shell)/terminos`, `?lang=en`) and
 * `sweepstakes` (the public sweepstakes flow, `app/g/[slug]`). `sellerAcquisition`
 * is es-only by deliberate code choice (the `/vende` family hardcodes `'es'`) even
 * though `en.json` carries unused translations for it. The embed widget's locale
 * toggle isn't dictionary-backed at all (no `embed` namespace exists).
 *
 * The admin copy-override editor (`/admin/contenido`) shows an `en` field ONLY for
 * a namespace on this list; the write route rejects an `en`-locale override for
 * any other namespace (defense in depth — the read side never requests `en` for a
 * non-listed namespace either, since only these surfaces thread a request locale).
 *
 * Extending bilingual support to a new surface is a deliberate act — add the
 * namespace here alongside actually wiring `getDictionary(locale)` at its call
 * site(s), never one without the other.
 */
export const BILINGUAL_NAMESPACES = ['terms', 'sweepstakes'] as const

export type BilingualNamespace = typeof BILINGUAL_NAMESPACES[number]

export function isBilingualNamespace(namespace: string): namespace is BilingualNamespace {
  return (BILINGUAL_NAMESPACES as readonly string[]).includes(namespace)
}
