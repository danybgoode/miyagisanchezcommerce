export type DictionaryContractIssue =
  | { path: string; issue: 'missing_in_en' | 'missing_in_es' | 'empty_en' | 'empty_es' | 'shape' }
  | { path: string; issue: 'array_length'; es: number; en: number }

/**
 * These optional acquisition fields intentionally suppress a visual element.
 * Keeping the exceptions named is preferable to either rendering new MX copy
 * during a no-visible-change sprint or letting every empty string pass.
 */
export const INTENTIONALLY_EMPTY_DICTIONARY_PATHS = new Set([
  'sellerAcquisition.aiChannel.eyebrow',
  'sellerAcquisition.aiChannel.note',
  'sellerAcquisition.anchor.eyebrow',
  'sellerAcquisition.anchor.routerCards[0].eyebrow',
  'sellerAcquisition.anchor.routerCards[0].statusLabel',
  'sellerAcquisition.anchor.routerCards[1].eyebrow',
  'sellerAcquisition.anchor.routerCards[2].eyebrow',
  'sellerAcquisition.anchor.routerCards[2].statusLabel',
  'sellerAcquisition.anchor.routerCards[3].eyebrow',
  'sellerAcquisition.anchor.routerCards[3].statusLabel',
  'sellerAcquisition.anchor.routerCards[4].eyebrow',
  'sellerAcquisition.anchor.routerCards[4].statusLabel',
  'sellerAcquisition.anchor.socialBody',
  'sellerAcquisition.anchor.socialTitle',
  'sellerAcquisition.autos.eyebrow',
  'sellerAcquisition.creadores.eyebrow',
  'sellerAcquisition.mundial.eyebrow',
  'sellerAcquisition.negocios.eyebrow',
  'sellerAcquisition.servicios.eyebrow',
])

function kind(value: unknown): 'array' | 'object' | 'string' | 'other' {
  if (Array.isArray(value)) return 'array'
  if (value !== null && typeof value === 'object') return 'object'
  if (typeof value === 'string') return 'string'
  return 'other'
}

function childPath(parent: string, child: string): string {
  return parent ? `${parent}.${child}` : child
}

/**
 * Recursively compare both dictionaries. Arrays are ordered authored content,
 * so their lengths and each element's shape are contract data just like keys.
 */
export function validateDictionaryPair(
  es: unknown,
  en: unknown,
  options: { allowEmptyPaths?: ReadonlySet<string> } = {},
): DictionaryContractIssue[] {
  const issues: DictionaryContractIssue[] = []

  function visit(esValue: unknown, enValue: unknown, path: string) {
    const esKind = kind(esValue)
    const enKind = kind(enValue)
    if (esKind !== enKind) {
      issues.push({ path, issue: 'shape' })
      return
    }

    if (esKind === 'string') {
      if (!options.allowEmptyPaths?.has(path)) {
        if (!(esValue as string).trim()) issues.push({ path, issue: 'empty_es' })
        if (!(enValue as string).trim()) issues.push({ path, issue: 'empty_en' })
      }
      return
    }

    if (esKind === 'array') {
      const esArray = esValue as unknown[]
      const enArray = enValue as unknown[]
      if (esArray.length !== enArray.length) {
        issues.push({ path, issue: 'array_length', es: esArray.length, en: enArray.length })
      }
      for (let index = 0; index < Math.min(esArray.length, enArray.length); index += 1) {
        visit(esArray[index], enArray[index], `${path}[${index}]`)
      }
      return
    }

    if (esKind === 'object') {
      const esObject = esValue as Record<string, unknown>
      const enObject = enValue as Record<string, unknown>
      for (const key of Object.keys(esObject).sort()) {
        const nextPath = childPath(path, key)
        if (!(key in enObject)) issues.push({ path: nextPath, issue: 'missing_in_en' })
        else visit(esObject[key], enObject[key], nextPath)
      }
      for (const key of Object.keys(enObject).sort()) {
        if (!(key in esObject)) issues.push({ path: childPath(path, key), issue: 'missing_in_es' })
      }
      return
    }

    // Dictionaries are strings, objects, and arrays only. Matching unsupported
    // leaves (number/boolean/null) are still a shape violation, not a quiet pass.
    issues.push({ path, issue: 'shape' })
  }

  visit(es, en, '')
  return issues
}

export function validatePlatformDictionaries(es: unknown, en: unknown): DictionaryContractIssue[] {
  return validateDictionaryPair(es, en, { allowEmptyPaths: INTENTIONALLY_EMPTY_DICTIONARY_PATHS })
}
