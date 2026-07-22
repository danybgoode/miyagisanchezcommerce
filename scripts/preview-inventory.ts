/**
 * scripts/preview-inventory.ts — founding-merchant-consent-previews S3.2.
 *
 * Generates the READ-ONLY historical inventory of promoter-created public/unclaimed
 * shops, so their disposition can be decided by hand (locked decision #4: audited,
 * not bulk-mutated).
 *
 * This script issues GET requests ONLY. It never writes, and it deliberately holds
 * no code path that could — the Supabase calls below are all PostgREST reads, and
 * the classification/rendering lives in the pure lib/preview-inventory.ts.
 *
 * Run:
 *   node --experimental-strip-types --env-file=.env.local scripts/preview-inventory.ts
 *   node --experimental-strip-types --env-file=.env.local scripts/preview-inventory.ts --json
 *
 * Writes the Markdown artifact to `preview-inventory.md` in the working directory
 * (or prints JSON with --json). The report BODY carries no timestamp so that
 * rerunning against an unchanged dataset is byte-identical.
 */
import { writeFileSync } from 'node:fs'
import {
  buildInventoryReport,
  renderInventoryMarkdown,
  type InventoryShop,
} from '../lib/preview-inventory.ts'

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Run with --env-file=.env.local')
  process.exit(1)
}

/** One paginated PostgREST GET. Read-only by construction — no method override. */
async function selectAll<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = []
  const pageSize = 1000
  for (let offset = 0; ; offset += pageSize) {
    const url = `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(columns)}&limit=${pageSize}&offset=${offset}`
    const res = await fetch(url, {
      method: 'GET',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    })
    if (!res.ok) {
      throw new Error(`GET ${table} failed: ${res.status} ${await res.text()}`)
    }
    const page = (await res.json()) as T[]
    out.push(...page)
    if (page.length < pageSize) return out
  }
}

type ShopRow = {
  id: string
  slug: string | null
  name: string | null
  source_url: string | null
  clerk_user_id: string | null
  updated_at: string | null
  created_at: string | null
}
type ListingRow = { shop_id: string | null; status: string | null; updated_at: string | null }
type AnchorRow = { shop_id: string | null; status: string | null }

async function main() {
  const [shops, listings, anchors] = await Promise.all([
    selectAll<ShopRow>('marketplace_shops', 'id,slug,name,source_url,clerk_user_id,updated_at,created_at'),
    selectAll<ListingRow>('marketplace_listings', 'shop_id,status,updated_at'),
    selectAll<AnchorRow>('merchant_previews', 'shop_id,status').catch(() => {
      // The S1/S2 tables may not exist yet in an environment where the migration
      // hasn't been applied. Report every shop as unanchored rather than failing —
      // a missing anchor table means nothing is in the consent flow yet.
      console.warn('[preview-inventory] merchant_previews unavailable — treating all shops as unanchored')
      return [] as AnchorRow[]
    }),
  ])

  const publicCount = new Map<string, number>()
  const lastActivity = new Map<string, string>()
  for (const l of listings) {
    if (!l.shop_id) continue
    if (l.status === 'active') publicCount.set(l.shop_id, (publicCount.get(l.shop_id) ?? 0) + 1)
    const prev = lastActivity.get(l.shop_id)
    if (l.updated_at && (!prev || l.updated_at > prev)) lastActivity.set(l.shop_id, l.updated_at)
  }

  const anchorByShop = new Map<string, string>()
  for (const a of anchors) {
    if (a.shop_id) anchorByShop.set(a.shop_id, a.status ?? 'draft')
  }

  const input: InventoryShop[] = shops.map((s) => ({
    id: s.id,
    slug: s.slug ?? '',
    name: s.name ?? '',
    sourceUrl: s.source_url,
    clerkUserId: s.clerk_user_id,
    publicListingCount: publicCount.get(s.id) ?? 0,
    hasAnchor: anchorByShop.has(s.id),
    anchorStatus: anchorByShop.get(s.id) ?? null,
    lastActivityAt: lastActivity.get(s.id) ?? s.updated_at ?? s.created_at ?? null,
  }))

  const report = buildInventoryReport(input)

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  const markdown = renderInventoryMarkdown(report)
  writeFileSync('preview-inventory.md', markdown)
  console.log(markdown)
  console.error(`\n[preview-inventory] wrote preview-inventory.md (${report.summary.total} shops, read-only)`)
}

main().catch((e) => {
  console.error('[preview-inventory] failed:', e)
  process.exit(1)
})
