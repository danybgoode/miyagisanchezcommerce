import es from '@/locales/es.json'
import en from '@/locales/en.json'

export type Locale = 'es' | 'en'
export type Dictionary = typeof es

const dictionaries: Record<Locale, Dictionary> = { es, en }

export function normalizeLocale(input?: string | null): Locale {
  return input === 'en' ? 'en' : 'es'
}

export async function getDictionary(locale?: string | null): Promise<Dictionary> {
  return dictionaries[normalizeLocale(locale)]
}
