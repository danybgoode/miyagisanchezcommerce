/**
 * One-off cutover backfill (epic 07 · subdomain-pricing, Sprint 1, US-2).
 *
 * Stamps a durable GRANDFATHER grant on EVERY shop that exists at cutover, so no
 * existing seller's free `<slug>.miyagisanchez.com` subdomain is ever taken away
 * once the `subdomain.paywall_enabled` flag is turned on. The grant lives at
 * `marketplace_shops.metadata.subdomain_grant` (read by the pure entitlement seam
 * `lib/subdomain-entitlement.ts`) — DISTINCT from the custom-domain SKU's
 * `custom_domain_grant`, so the two never leak entitlement to each other.
 *
 * Unlike the custom-domain backfill (which only grandfathered `custom_domain`
 * holders), EVERY shop has a free subdomain today, so this stamps ALL shops —
 * which is why it PAGINATES the Supabase REST read (a single unpaged GET is capped
 * and would silently miss shops, trapping sellers when the flag flips).
 *
 * ⚠️  RUN ORDER: run this BEFORE flipping `subdomain.paywall_enabled` on in
 *     Flagsmith. The flag defaults OFF (fail-open ⇒ ungated), so the deploy is
 *     inert until both this backfill has run AND Daniel flips the flag.
 *
 * Run (DRY-RUN by default — prints what it WOULD stamp, writes nothing):
 *   node --env-file=.env.local scripts/backfill-subdomain-grandfather.mjs
 * Apply for real:
 *   node --env-file=.env.local scripts/backfill-subdomain-grandfather.mjs --apply
 *
 * Idempotent — skips shops that already carry a VALID subdomain_grant; a corrupt
 * grant (one readSubdomainGrant would reject) is re-stamped, never left to deny.
 *
 * The same field is the hand-grant (comp) mechanism: to comp a shop, set
 * metadata.subdomain_grant = { type:'comp', granted_at, note }.
 */

const APPLY = process.argv.includes('--apply')
const PAGE = 1000

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1)
}
const H = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' }

/**
 * The grant-validity rule, inlined to mirror lib/subdomain-entitlement.ts
 * `readSubdomainGrant` (this is a plain .mjs and can't import the .ts seam). A
 * value that fails this is treated as "no grant" — both here (re-stamp) and at
 * runtime (deny) — so the two never disagree.
 */
function isValidGrant(g) {
  if (!g || typeof g !== 'object') return false
  if (g.type !== 'grandfather' && g.type !== 'comp' && g.type !== 'one_time') return false
  if (typeof g.granted_at !== 'string' || g.granted_at === '') return false
  if (g.type === 'one_time' && (typeof g.expires_at !== 'string' || g.expires_at === '')) return false
  return true
}

console.log(APPLY ? '== APPLY: stamping grandfather grants ==' : '== DRY-RUN: no writes (pass --apply to write) ==')

// Paginate the full shop list — EVERY shop is a candidate (every shop has a free
// subdomain today). Supabase REST caps a single response, so we page with Range
// until a short page signals the end; never silently truncate the candidate set.
const rows = []
for (let offset = 0; ; offset += PAGE) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/marketplace_shops?select=id,slug,metadata&order=id.asc`,
    { headers: { ...H, Range: `${offset}-${offset + PAGE - 1}`, 'Range-Unit': 'items' } },
  )
  if (!res.ok) { console.error('fetch failed', res.status, await res.text()); process.exit(1) }
  const page = await res.json()
  rows.push(...page)
  if (page.length < PAGE) break  // last (short) page reached
}
console.log(`Found ${rows.length} shop(s).`)

const now = new Date().toISOString()
let granted = 0, skipped = 0, failed = 0
for (const r of rows) {
  if (isValidGrant(r.metadata?.subdomain_grant)) { skipped++; continue }  // idempotent (valid grants only)
  if (!APPLY) { granted++; console.log('  would stamp', r.slug); continue }
  const metadata = {
    ...(r.metadata ?? {}),
    subdomain_grant: { type: 'grandfather', granted_at: now, note: 'cutover' },
  }
  const u = await fetch(`${SUPABASE_URL}/rest/v1/marketplace_shops?id=eq.${r.id}`, {
    method: 'PATCH', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify({ metadata }),
  })
  // return=representation lets us confirm a row ACTUALLY changed (a 2xx with an
  // empty array = predicate matched nothing → a phantom "grant" that never wrote).
  const updated = u.ok ? await u.json().catch(() => []) : []
  if (u.ok && Array.isArray(updated) && updated.length === 1) { granted++; console.log('  ✓', r.slug) }
  else { failed++; console.error('  x', r.id, u.status, u.ok ? `rows=${updated.length}` : (await u.text()).slice(0, 80)) }
}
console.log(
  APPLY
    ? `\nDone. grandfathered=${granted} skipped(valid grant)=${skipped} failed=${failed}`
    : `\nDry-run. would-grandfather=${granted} skipped(valid grant)=${skipped} — re-run with --apply to write.`,
)
if (APPLY && failed > 0) process.exit(1)  // fail loud: a partial backfill before the flag flip traps sellers
