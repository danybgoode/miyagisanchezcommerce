#!/usr/bin/env node
/**
 * One-off backfill: find listings still serving a HOTLINKED (non-R2) image
 * — the state every listing was in before hyper-performant-website S1.3 wired
 * R2 ingestion into the live supply-import path — and copy those images into
 * R2, updating both the Supabase read-mirror (`marketplace_listings.images`,
 * what /sell/edit reads) and the Medusa product itself (`/store/listings`,
 * what the homepage + browse actually render).
 *
 * DEFAULT MODE IS REPORT-ONLY (no writes) — running it with no flags is
 * exactly the "flag existing hotlinked listings" half of Story 1.3's
 * acceptance criterion; add --apply to also fix them.
 *
 * Idempotent: a listing whose every image is already on the R2 host is
 * skipped, so a partial/interrupted --apply run is safe to re-run.
 *
 * Needs credentials this agent does not have in the worktree — NOT run here.
 *
 * Run:
 *   node --env-file=.env.local scripts/backfill-hotlinked-images.mjs            # report only
 *   node --env-file=.env.local scripts/backfill-hotlinked-images.mjs --apply    # fix them
 *   node --env-file=.env.local scripts/backfill-hotlinked-images.mjs --apply --limit=25
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, R2_ACCOUNT_ID,
 * R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_IMAGES, R2_PUBLIC_URL,
 * MEDUSA_STORE_URL, MEDUSA_INTERNAL_SECRET
 */
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

const APPLY = process.argv.includes('--apply')
const limitArg = process.argv.find((a) => a.startsWith('--limit='))
const ROW_LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY
const R2_BUCKET_IMAGES = process.env.R2_BUCKET_IMAGES
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL
const MEDUSA_STORE_URL = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const MEDUSA_INTERNAL_SECRET = process.env.MEDUSA_INTERNAL_SECRET

const missing = Object.entries({
  SUPABASE_URL, SUPABASE_KEY, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
  R2_BUCKET_IMAGES, R2_PUBLIC_URL, MEDUSA_INTERNAL_SECRET,
}).filter(([, v]) => !v).map(([k]) => k)
if (missing.length > 0) {
  console.error('Missing required env: ' + missing.join(', '))
  process.exit(1)
}

const R2_HOST = new URL(R2_PUBLIC_URL).hostname
const SB_HEADERS = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' }
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
})

const EXT_BY_TYPE = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' }

function isExternal(url) {
  try { return new URL(url).hostname !== R2_HOST } catch { return true } // unparsable → treat as needing attention
}

async function ingestOne(url, listingId, idx) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`upstream ${res.status}`)
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  const ext = EXT_BY_TYPE[type]
  if (!ext) throw new Error(`unsupported content-type ${type}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.byteLength === 0 || buf.byteLength > 25 * 1024 * 1024) throw new Error(`bad size ${buf.byteLength}B`)
  const key = `listing-images/backfill/${listingId}/${Date.now()}-${idx}.${ext}`
  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET_IMAGES,
    Key: key,
    Body: buf,
    ContentType: type,
    ACL: 'public-read',
    CacheControl: 'public, max-age=31536000, immutable',
  }))
  return `${R2_PUBLIC_URL}/${key}`
}

// ── 1. Find candidate listings (Supabase mirror is the join point for shop slug) ──
const listRes = await fetch(
  `${SUPABASE_URL}/rest/v1/marketplace_listings?select=id,medusa_product_id,images,marketplace_shops!inner(slug)&status=neq.deleted&medusa_product_id=not.is.null`,
  { headers: SB_HEADERS },
)
if (!listRes.ok) { console.error('listing fetch failed', listRes.status, await listRes.text()); process.exit(1) }
const rows = await listRes.json()
console.log(`Scanned ${rows.length} non-deleted listings.`)

const candidates = rows
  .map((r) => ({
    id: r.id,
    medusa_product_id: r.medusa_product_id,
    seller_slug: r.marketplace_shops?.slug,
    images: Array.isArray(r.images) ? r.images : [],
  }))
  .filter((r) => r.seller_slug && r.images.some((img) => isExternal(img.url)))
  .slice(0, ROW_LIMIT)

console.log(`Found ${candidates.length} listing(s) with a hotlinked (non-R2) image.`)
console.log(`Mode: ${APPLY ? 'APPLY (rewriting)' : 'REPORT ONLY (pass --apply to fix)'}\n`)

let fixed = 0, partiallyFixed = 0, failed = 0

for (const c of candidates) {
  const externalCount = c.images.filter((img) => isExternal(img.url)).length
  console.log(`- ${c.id} (${c.seller_slug}): ${externalCount}/${c.images.length} hotlinked image(s)`)
  if (!APPLY) continue

  let anyFailed = false
  const finalImages = []
  for (const [idx, img] of c.images.entries()) {
    if (!isExternal(img.url)) { finalImages.push(img); continue }
    try {
      const r2Url = await ingestOne(img.url, c.id, idx)
      finalImages.push({ url: r2Url, alt: img.alt })
    } catch (err) {
      anyFailed = true
      finalImages.push(img) // keep original — never lose an image
      console.error(`    x image ${idx} (${img.url}):`, err instanceof Error ? err.message : err)
    }
  }

  // Update the Supabase read-mirror.
  const sbUpdate = await fetch(`${SUPABASE_URL}/rest/v1/marketplace_listings?id=eq.${c.id}`, {
    method: 'PATCH', headers: { ...SB_HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify({ images: finalImages }),
  })
  if (!sbUpdate.ok) {
    failed++
    console.error(`    x Supabase mirror update failed for ${c.id}:`, sbUpdate.status, (await sbUpdate.text()).slice(0, 200))
    continue
  }

  // Update the actual Medusa product (the homepage/browse read path).
  const medusaUpdate = await fetch(`${MEDUSA_STORE_URL}/internal/seller-products/${c.medusa_product_id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': MEDUSA_INTERNAL_SECRET },
    body: JSON.stringify({ seller_slug: c.seller_slug, images: finalImages, images_mode: 'replace' }),
  })
  if (!medusaUpdate.ok) {
    failed++
    console.error(`    x Medusa product update failed for ${c.id}:`, medusaUpdate.status, (await medusaUpdate.text()).slice(0, 200))
    continue
  }

  if (anyFailed) { partiallyFixed++; console.log(`    ~ partially fixed (some images kept hotlinked)`) }
  else { fixed++; console.log(`    ✓ fixed`) }
}

console.log(`\nDone. candidates=${candidates.length} fixed=${fixed} partially_fixed=${partiallyFixed} failed=${failed}`)
if (!APPLY) console.log('(report only — re-run with --apply to fix)')
