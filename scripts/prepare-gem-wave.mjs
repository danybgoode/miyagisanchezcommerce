#!/usr/bin/env node
/**
 * Refresh a Gem campaign's merchant seeds from Shopify-compatible product JSON
 * and emit supply-import CSVs. READ-ONLY against merchant sites; it never calls
 * Miyagi Sánchez.
 *
 * Usage:
 *   node scripts/prepare-gem-wave.mjs campaigns/gem-wave-01/manifest.json ./prepared
 */
import fs from 'node:fs/promises'
import path from 'node:path'

const manifestPath = process.argv[2]
const outputDir = process.argv[3] ?? './prepared'
if (!manifestPath) throw new Error('Pass a campaign manifest path')
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
await fs.mkdir(outputDir, { recursive: true })

const stripHtml = (s = '') => String(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const productJsonUrl = (u) => `${u.replace(/\/$/, '')}.js`
const csvCell = (value) => {
  const s = value == null ? '' : String(value)
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}

async function hydrate(seed) {
  try {
    const res = await fetch(productJsonUrl(seed.source_url), {
      headers: { 'user-agent': 'Miyagi-Sanchez-Supply-Research/1.0' },
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const product = await res.json()
    const variants = Array.isArray(product.variants) ? product.variants : []
    const variant = variants.find((v) => v?.available) ?? variants[0] ?? null
    const cents = typeof variant?.price === 'number' ? variant.price : null
    const images = (product.images ?? [])
      .map((image) => typeof image === 'string' ? image : image?.src)
      .filter(Boolean)
      .slice(0, 6)
    return {
      ...seed,
      title: String(product.title || seed.title).trim().slice(0, 100),
      description: stripHtml(product.description || product.body_html || ''),
      price: cents != null ? cents / 100 : seed.price,
      images,
      source_verified_at: new Date().toISOString(),
      source_fetch: 'shopify-product-json',
    }
  } catch (error) {
    return {
      ...seed,
      description: '',
      images: [],
      source_fetch: 'seed-fallback',
      source_error: error instanceof Error ? error.message : String(error),
    }
  }
}

const header = [
  'source_url', 'title', 'description', 'price', 'currency', 'shop_name', 'shop_source_url',
  'shop_description', 'location', 'state', 'municipio', 'images', 'category', 'listing_type',
  'condition', 'operating_market',
]

const byMarket = new Map()
const report = { campaign: manifest.campaign, prepared_at: new Date().toISOString(), shops: [] }
for (const shop of manifest.shops) {
  const products = []
  for (const seed of shop.products) products.push(await hydrate(seed))
  report.shops.push({ ...shop, products })
  const market = shop.operating_market
  if (!byMarket.has(market)) byMarket.set(market, [])
  for (const product of products) {
    byMarket.get(market).push([
      product.source_url,
      product.title,
      product.description,
      product.price,
      shop.currency,
      shop.name,
      shop.source_shop_url,
      shop.description,
      shop.location ?? '',
      shop.state ?? '',
      shop.municipio ?? '',
      (product.images ?? []).join(','),
      shop.category,
      'product',
      product.condition ?? 'new',
      market,
    ])
  }
}

await fs.writeFile(path.join(outputDir, 'prepared.json'), JSON.stringify(report, null, 2) + '\n')
for (const [market, rows] of byMarket) {
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n') + '\n'
  await fs.writeFile(path.join(outputDir, `${market}.csv`), csv)
}

const failed = report.shops.flatMap((shop) => shop.products
  .filter((product) => product.source_error)
  .map((product) => ({ shop: shop.name, source_url: product.source_url, error: product.source_error })))
console.log(`Prepared ${report.shops.length} shops / ${report.shops.reduce((count, shop) => count + shop.products.length, 0)} products.`)
console.log(`Wrote ${[...byMarket.keys()].map((market) => path.join(outputDir, `${market}.csv`)).join(', ')} and prepared.json.`)
if (failed.length) {
  console.error('WARNING: source refresh failed for:')
  for (const row of failed) console.error(`- ${row.shop}: ${row.source_url} (${row.error})`)
  console.error('Review/replace failed products before import. Seed values remain only as a fallback.')
  process.exitCode = 2
}
