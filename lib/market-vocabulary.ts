import { CATEGORIES, type CategoryKey, type SortOption } from './types'

export type BuyerLanguage = 'es' | 'en'

const EN_CATEGORY: Readonly<Record<CategoryKey, string>> = Object.freeze({
  autos: 'Cars & motorcycles', inmuebles: 'Real estate', electronica: 'Electronics',
  hogar: 'Home & garden', moda: 'Fashion & clothing', deportes: 'Sports',
  servicios: 'Services', mascotas: 'Pets', herramientas: 'Tools', negocios: 'Business & B2B',
  cursos: 'Courses & workshops', comunidad: 'Memberships & communities',
  creatividad: 'Art & design', otros: 'Other',
})

export function categoryLabel(key: string, language: BuyerLanguage): string {
  const source = CATEGORIES.find((category) => category.key === key)
  if (!source) return key
  return language === 'en' ? EN_CATEGORY[source.key] : source.label
}

const EN_LISTING_TYPE: Readonly<Record<string, string>> = Object.freeze({
  product: 'Products', service: 'Services', rental: 'Rentals', digital: 'Digital', subscription: 'Subscriptions',
})

export function listingTypeLabel(value: string, fallback: string, language: BuyerLanguage): string {
  return language === 'en' ? EN_LISTING_TYPE[value] ?? fallback : fallback
}

const EN_SORT: Readonly<Partial<Record<SortOption, string>>> = Object.freeze({
  reciente: 'Most recent', precio_asc: 'Lowest price', precio_desc: 'Highest price',
  popular: 'Most viewed', year_desc: 'Newest year', year_asc: 'Oldest year', marca: 'Make (A–Z)',
})

export function sortLabel(value: SortOption | '', fallback: string, language: BuyerLanguage): string {
  return language === 'en' ? EN_SORT[value as SortOption] ?? fallback : fallback
}

const EN_CONDITION: Readonly<Record<string, string>> = Object.freeze({
  '': 'Any condition', new: 'New', like_new: 'Like new', good: 'Good', fair: 'Fair', parts: 'For parts',
})

export function conditionFilterLabel(value: string, fallback: string, language: BuyerLanguage): string {
  return language === 'en' ? EN_CONDITION[value] ?? fallback : fallback
}

const EN_PROPERTY: Readonly<Record<string, string>> = Object.freeze({
  departamento: 'Apartments', casa: 'Houses', terreno: 'Land', oficina: 'Offices / commercial',
  bodega: 'Warehouses', otro: 'Other',
})

export function propertyTypeLabel(value: string, fallback: string, language: BuyerLanguage): string {
  return language === 'en' ? EN_PROPERTY[value] ?? fallback : fallback
}
