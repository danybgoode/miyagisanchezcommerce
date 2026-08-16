import { expect, test } from '@playwright/test'
import en from '../locales/en.json' with { type: 'json' }
import es from '../locales/es.json' with { type: 'json' }
import {
  INTENTIONALLY_EMPTY_DICTIONARY_PATHS,
  validateDictionaryPair,
  validatePlatformDictionaries,
} from '../lib/dictionary-contract'

test.describe('dictionary contract · recursive bilingual completeness', () => {
  test('real dictionaries have identical object keys and array lengths with no empty leaves', () => {
    expect(validatePlatformDictionaries(es, en)).toEqual([])
    expect(INTENTIONALLY_EMPTY_DICTIONARY_PATHS.size).toBeGreaterThan(0)
  })

  test('reports a nested missing key with its full path', () => {
    expect(validateDictionaryPair(
      { shell: { footer: { terms: 'Términos' } } },
      { shell: { footer: {} } },
    )).toContainEqual({ path: 'shell.footer.terms', issue: 'missing_in_en' })
  })

  test('reports array-length drift instead of comparing only the first item', () => {
    expect(validateDictionaryPair(
      { faq: [{ title: 'Uno' }, { title: 'Dos' }] },
      { faq: [{ title: 'One' }] },
    )).toContainEqual({ path: 'faq', issue: 'array_length', es: 2, en: 1 })
  })

  test('reports empty strings in either locale', () => {
    expect(validateDictionaryPair(
      { state: { empty: 'Nada todavía' } },
      { state: { empty: '   ' } },
    )).toContainEqual({ path: 'state.empty', issue: 'empty_en' })
  })

  test('reports shape mismatches rather than silently descending', () => {
    expect(validateDictionaryPair(
      { choices: ['Uno'] },
      { choices: { first: 'One' } },
    )).toContainEqual({ path: 'choices', issue: 'shape' })
  })
})
