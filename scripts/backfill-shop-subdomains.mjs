/**
 * One-off backfill: register every existing shop's free subdomain
 * (`<slug>.miyagisanchez.com`) on the Vercel project so Vercel issues a per-host
 * TLS cert. New shops self-register on create / slug-change (lib/vercel-domains
 * registerShopSubdomain); this covers shops that existed before the subdomains
 * epic shipped.
 *
 * Run (needs SUPABASE_* + VERCEL_* in env):
 *   node --env-file=.env.local scripts/backfill-shop-subdomains.mjs
 *
 * Idempotent + safe to re-run (a domain already on the project is a no-op).
 * Harmless to run before the GoDaddy `*` CNAME exists — Vercel just holds the
 * domain until DNS resolves, then issues the cert.
 */

const ROOT = 'miyagisanchez.com'
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const VERCEL_TOKEN = process.env.VERCEL_API_TOKEN
const VERCEL_PROJECT = process.env.VERCEL_PROJECT_ID

// Labels that must never become a shop subdomain (mirror of lib/subdomain).
const RESERVED = new Set([
  'admin', 'api', 'app', 'sell', 'search', 'orders', 'inbox', 'profile', 'perfil',
  'ayuda', 'help', 's', 'shop', 'www', 'billing', 'support', 'soporte', 'account',
  'cuenta', 'sign-in', 'sign-up', 'embed', 'l', 'messages', 'mensajes', 'checkout',
  'cart', 'carrito', 'settings', 'ajustes', 'supply', 'terminos', 'mschz',
  'clerk', 'accounts', 'mail', 'email', 'cdn', 'assets', 'static', 'media',
])

if (!SUPABASE_URL || !SUPABASE_KEY || !VERCEL_TOKEN || !VERCEL_PROJECT) {
  console.error('Missing env: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / VERCEL_API_TOKEN / VERCEL_PROJECT_ID')
  process.exit(1)
}

const res = await fetch(`${SUPABASE_URL}/rest/v1/marketplace_shops?select=slug`, {
  headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
})
if (!res.ok) { console.error('Supabase fetch failed:', res.status, await res.text()); process.exit(1) }
const shops = await res.json()
const slugs = [...new Set(shops.map(s => (s.slug || '').trim().toLowerCase()).filter(Boolean))]
console.log(`Found ${slugs.length} shop slugs.`)

let ok = 0, skipped = 0, failed = 0
for (const slug of slugs) {
  if (RESERVED.has(slug) || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(slug)) { skipped++; continue }
  const r = await fetch(`https://api.vercel.com/v10/projects/${VERCEL_PROJECT}/domains`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `${slug}.${ROOT}` }),
  })
  const body = await r.json().catch(() => ({}))
  if (r.ok || body?.error?.code === 'domain_already_in_use') {
    ok++; console.log(`✓ ${slug}.${ROOT}`)
  } else {
    failed++; console.error(`✗ ${slug}.${ROOT}:`, body?.error?.message ?? r.status)
  }
}
console.log(`\nDone. registered/exists=${ok} skipped=${skipped} failed=${failed}`)
