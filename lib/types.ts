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
  listing_type: 'product' | 'service' | 'rental'
  location: string | null
  images: Array<{ url: string; alt?: string }>
  tags: string[]
  status: string
  source_platform: string | null
  views: number
  created_at: string
  shop?: Shop
}

export type SearchParams = {
  q?: string
  type?: string
  condition?: string
  min_price?: string
  max_price?: string
  location?: string
  page?: string
}
