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
 * holders), EVERY shop has a free subdomain today, so this stamps ALL shops.
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
 * Idempotent — skips shops that already carry a subdomain_grant.
 *
 * The same field is the hand-grant (comp) mechanism: to comp a shop, set
 * metadata.subdomain_grant = { type:'comp', granted_at, note }.
 */

const APPLY = process.argv.includes('--apply')

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1)
}
const H = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' }

console.log(APPLY ? '== APPLY: stamping grandfather grants ==' : '== DRY-RUN: no writes (pass --apply to write) ==')

// EVERY shop is a candidate — every shop has a free subdomain today.
const res = await fetch(
  `${SUPABASE_URL}/rest/v1/marketplace_shops?select=id,slug,metadata`,
  { headers: H },
)
if (!res.ok) { console.error('fetch failed', res.status, await res.text()); process.exit(1) }
const rows = await res.json()
console.log(`Found ${rows.length} shop(s).`)

const now = new Date().toISOString()
let granted = 0, skipped = 0, failed = 0
for (const r of rows) {
  if (r.metadata?.subdomain_grant) { skipped++; continue }  // idempotent
  if (!APPLY) { granted++; console.log('  would stamp', r.slug); continue }
  const metadata = {
    ...(r.metadata ?? {}),
    subdomain_grant: { type: 'grandfather', granted_at: now, note: 'cutover' },
  }
  const u = await fetch(`${SUPABASE_URL}/rest/v1/marketplace_shops?id=eq.${r.id}`, {
    method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ metadata }),
  })
  if (u.ok) { granted++; console.log('  ✓', r.slug) }
  else { failed++; console.error('  x', r.id, u.status, (await u.text()).slice(0, 80)) }
}
console.log(
  APPLY
    ? `\nDone. grandfathered=${granted} skipped(existing grant)=${skipped} failed=${failed}`
    : `\nDry-run. would-grandfather=${granted} skipped(existing grant)=${skipped} — re-run with --apply to write.`,
)
