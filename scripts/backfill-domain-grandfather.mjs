/**
 * One-off cutover backfill (epic: custom-domain-paywall, Sprint 1, Story 1.2).
 *
 * Stamps a durable GRANDFATHER grant on every shop that already has a live
 * `custom_domain`, so existing custom-domain holders stay entitled forever once
 * the `domain.paywall_enabled` flag is turned on. The grant lives at
 * `marketplace_shops.metadata.custom_domain_grant` (read by the pure entitlement
 * seam `lib/domain-entitlement.ts`) — distinct from "currently has a domain" so
 * it survives Sprint 2's lapse logic.
 *
 * ⚠️  RUN ORDER: run this BEFORE flipping `domain.paywall_enabled` on in
 *     the flag store. The flag defaults OFF (fail-open ⇒ ungated), so the deploy is
 *     inert until both this backfill has run and Daniel flips the flag.
 *
 * Run:  node --env-file=.env.local scripts/backfill-domain-grandfather.mjs
 * Idempotent — skips shops that already carry a custom_domain_grant.
 *
 * The same field is the hand-grant (comp) mechanism: to comp a domain-less
 * seller, set metadata.custom_domain_grant = { type:'comp', granted_at, note }.
 */

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1)
}
const H = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' }

// Only shops with a non-null custom_domain are candidates for grandfathering.
const res = await fetch(
  `${SUPABASE_URL}/rest/v1/marketplace_shops?select=id,slug,custom_domain,metadata&custom_domain=not.is.null`,
  { headers: H },
)
if (!res.ok) { console.error('fetch failed', res.status, await res.text()); process.exit(1) }
const rows = await res.json()
console.log(`Found ${rows.length} shop(s) with a custom_domain.`)

const now = new Date().toISOString()
let granted = 0, skipped = 0, failed = 0
for (const r of rows) {
  if (r.metadata?.custom_domain_grant) { skipped++; continue }  // idempotent
  const metadata = {
    ...(r.metadata ?? {}),
    custom_domain_grant: { type: 'grandfather', granted_at: now, note: 'cutover' },
  }
  const u = await fetch(`${SUPABASE_URL}/rest/v1/marketplace_shops?id=eq.${r.id}`, {
    method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ metadata }),
  })
  if (u.ok) { granted++; console.log('  ✓', r.slug, '→', r.custom_domain) }
  else { failed++; console.error('  x', r.id, u.status, (await u.text()).slice(0, 80)) }
}
console.log(`\nDone. grandfathered=${granted} skipped(existing grant)=${skipped} failed=${failed}`)
