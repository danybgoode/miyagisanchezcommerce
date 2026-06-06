/**
 * One-off backfill: mint a `short_code` in `marketplace_listings.metadata` for
 * every existing listing that lacks one (the mschz.org/[code] short link). New
 * listings get one automatically via syncSupabaseListingMirror.
 *
 * Run:  node --env-file=.env.local scripts/backfill-listing-shortcodes.mjs
 * Idempotent — skips listings that already have a short_code.
 */

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
const code = (n = 6) => Array.from({ length: n }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('')

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1)
}
const H = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' }

const res = await fetch(`${SUPABASE_URL}/rest/v1/marketplace_listings?select=id,metadata`, { headers: H })
if (!res.ok) { console.error('fetch failed', res.status, await res.text()); process.exit(1) }
const rows = await res.json()
console.log(`Found ${rows.length} listings.`)

const used = new Set(rows.map(r => r.metadata?.short_code).filter(Boolean))
let minted = 0, skipped = 0, failed = 0
for (const r of rows) {
  if (r.metadata?.short_code) { skipped++; continue }
  let c = code(); while (used.has(c)) c = code()
  used.add(c)
  const metadata = { ...(r.metadata ?? {}), short_code: c }
  const u = await fetch(`${SUPABASE_URL}/rest/v1/marketplace_listings?id=eq.${r.id}`, {
    method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ metadata }),
  })
  if (u.ok) { minted++; } else { failed++; console.error('  x', r.id, u.status, (await u.text()).slice(0, 80)) }
}
console.log(`\nDone. minted=${minted} skipped(existing)=${skipped} failed=${failed}`)
