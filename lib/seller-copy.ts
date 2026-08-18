import type { SellerLocale } from './seller-locale'

export interface SellerCopyEntry {
  readonly key: string
  readonly source: string
}

export type SellerCopyTransform = (value: string, locale?: SellerLocale) => string

const PLACEHOLDER = /\{(\d+)\}/g

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function renderedText(value: string): string {
  return value.replace(
    /&(amp|apos|quot|ldquo|rdquo|nbsp|lt|gt);/g,
    (_entity, name: string) => ({
      amp: '&', apos: "'", quot: '"', ldquo: '“', rdquo: '”', nbsp: '\u00a0', lt: '<', gt: '>',
    })[name] ?? _entity,
  )
}

function compileTemplate(source: string): RegExp {
  let cursor = 0
  let pattern = '^'
  for (const match of source.matchAll(PLACEHOLDER)) {
    pattern += escapeRegExp(source.slice(cursor, match.index))
    pattern += '(.+?)'
    cursor = (match.index ?? 0) + match[0].length
  }
  pattern += `${escapeRegExp(source.slice(cursor))}$`
  return new RegExp(pattern, 'u')
}

function interpolate(value: string, captures: readonly string[]): string {
  return value.replace(PLACEHOLDER, (_token, index: string) => captures[Number(index)] ?? '')
}

/**
 * Build the one page-copy transform.
 *
 * The original strings remain in the TSX files and the generated population
 * manifest — Spanish is the authored source and therefore the IDENTITY case.
 * Only English substitutes words, which is why the switch here is the render
 * LOCALE and not the shop's market: the market merely defaults the locale
 * (`lib/seller-locale.ts`), and a US shop reading Spanish must get the authored
 * strings back untouched.
 */
export function createSellerCopyTransform(
  entries: readonly SellerCopyEntry[],
  localized: Readonly<Record<string, string>>,
): SellerCopyTransform {
  const exact = new Map<string, string>()
  const templates: Array<{ source: string; translated: string; pattern: RegExp }> = []

  for (const entry of entries) {
    const translated = localized[entry.key]
    if (!translated) continue
    const sources = new Set([entry.source, renderedText(entry.source)])
    if (PLACEHOLDER.test(entry.source)) {
      PLACEHOLDER.lastIndex = 0
      for (const source of sources) templates.push({ source, translated, pattern: compileTemplate(source) })
    } else {
      for (const source of sources) exact.set(source, translated)
    }
  }
  templates.sort((a, b) => b.source.length - a.source.length)

  return (value, locale = 'es') => {
    if (locale !== 'en') return value
    const direct = exact.get(value)
    if (direct !== undefined) return direct
    for (const template of templates) {
      const match = template.pattern.exec(value)
      if (match) return interpolate(template.translated, match.slice(1))
    }
    return value
  }
}

const LOCALIZED_ATTRIBUTES = new Set(['title', 'placeholder', 'aria-label'])

/** Transform only copy-bearing attributes; every structural prop is preserved. */
export function localizeSellerAttributes<T extends Readonly<Record<string, string>>>(
  attributes: T,
  locale: SellerLocale,
  copy: SellerCopyTransform,
): T {
  if (locale !== 'en') return attributes
  return Object.fromEntries(
    Object.entries(attributes).map(([key, value]) => [
      key,
      LOCALIZED_ATTRIBUTES.has(key) ? copy(value, locale) : value,
    ]),
  ) as T
}
