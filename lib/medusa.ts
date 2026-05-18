const BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'

async function storeFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}/store${path}`, {
    headers: { 'x-publishable-api-key': '' },
    next: { revalidate: 60 },
  })
  if (!res.ok) throw new Error(`Medusa ${path} → ${res.status}`)
  return res.json()
}

export type StoreProduct = {
  id: string
  title: string
  description: string | null
  thumbnail: string | null
  status: string
  metadata: Record<string, unknown> | null
  variants: Array<{
    id: string
    title: string
    sku: string | null
    calculated_price?: { calculated_amount: number; currency_code: string } | null
    prices: Array<{ amount: number; currency_code: string }>
  }>
}

export const store = {
  products: {
    list: (params = '') =>
      storeFetch<{ products: StoreProduct[]; count: number }>(`/products?${params}`),
    get: (id: string) =>
      storeFetch<{ product: StoreProduct }>(`/products/${id}`),
  },
}
