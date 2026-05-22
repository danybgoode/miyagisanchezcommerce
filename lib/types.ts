export type Shop = {
  id: string
  slug: string
  name: string
  description: string | null
  location: string | null
  logo_url: string | null
  clerk_user_id: string | null
  verified: boolean
  source: string | null
  source_url: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

export type Listing = {
  id: string
  shop_id: string
  medusa_product_id: string | null
  title: string
  description: string | null
  price_cents: number | null
  currency: string
  condition: 'new' | 'like_new' | 'good' | 'fair' | 'parts' | null
  listing_type: 'product' | 'service' | 'rental' | 'digital' | 'subscription'
  category: string | null
  state: string | null
  municipio: string | null
  location: string | null
  metadata: Record<string, unknown>
  images: Array<{ url: string; alt?: string }>
  tags: string[]
  status: string
  source_platform: string | null
  source_url: string | null
  views: number
  created_at: string
  shop?: Shop
}

export type SortOption = 'reciente' | 'precio_asc' | 'precio_desc' | 'popular'

export type SearchParams = {
  q?: string
  category?: string
  state?: string
  municipio?: string
  condition?: string
  min_price?: string
  max_price?: string
  location?: string
  sort?: SortOption
  page?: string
  // Autos filters
  brand?: string
  year_from?: string
  year_to?: string
  km_from?: string
  km_to?: string
  transmission?: string
  fuel?: string
  // Inmuebles filters
  rooms_min?: string
  rooms_max?: string
  surface_min?: string
  surface_max?: string
  property_type?: string  // comma-separated: "casa,departamento"
}

export const CATEGORIES = [
  { key: 'autos', label: 'Autos y motos', icon: '🚗' },
  { key: 'inmuebles', label: 'Inmuebles', icon: '🏠' },
  { key: 'electronica', label: 'Electrónica', icon: '📱' },
  { key: 'hogar', label: 'Hogar y jardín', icon: '🪴' },
  { key: 'moda', label: 'Moda y ropa', icon: '👗' },
  { key: 'deportes', label: 'Deportes', icon: '⚽' },
  { key: 'servicios', label: 'Servicios', icon: '🔧' },
  { key: 'mascotas', label: 'Mascotas', icon: '🐾' },
  { key: 'herramientas', label: 'Herramientas', icon: '🔨' },
  { key: 'negocios', label: 'Negocios B2B', icon: '🏭' },
  // Digital creator categories
  { key: 'cursos', label: 'Cursos y talleres', icon: '🎓' },
  { key: 'comunidad', label: 'Membresía / comunidad', icon: '👥' },
  { key: 'creatividad', label: 'Arte y diseño', icon: '🎨' },
  { key: 'otros', label: 'Otros', icon: '📦' },
] as const

export type CategoryKey = typeof CATEGORIES[number]['key']

export const MEXICAN_STATES = [
  'Aguascalientes', 'Baja California', 'Baja California Sur', 'Campeche',
  'Chiapas', 'Chihuahua', 'Ciudad de México', 'Coahuila', 'Colima', 'Durango',
  'Estado de México', 'Guanajuato', 'Guerrero', 'Hidalgo', 'Jalisco',
  'Michoacán', 'Morelos', 'Nayarit', 'Nuevo León', 'Oaxaca', 'Puebla',
  'Querétaro', 'Quintana Roo', 'San Luis Potosí', 'Sinaloa', 'Sonora',
  'Tabasco', 'Tamaulipas', 'Tlaxcala', 'Veracruz', 'Yucatán', 'Zacatecas',
] as const
