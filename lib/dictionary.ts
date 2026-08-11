import es from '@/locales/es.json' with { type: 'json' }
import en from '@/locales/en.json' with { type: 'json' }

export type Locale = 'es' | 'en'
export type Dictionary = typeof es

const dictionaries: Record<Locale, Dictionary> = { es, en }

export function normalizeLocale(input?: string | null): Locale {
  const language = input?.trim().replace('_', '-').toLowerCase().split('-')[0]
  return language === 'en' ? 'en' : 'es'
}

export async function getDictionary(locale?: string | null): Promise<Dictionary> {
  return dictionaries[normalizeLocale(locale)]
}
