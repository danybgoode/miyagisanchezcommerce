/**
 * scripts/backfill-paywall-grants.ts
 *
 * Stamps the grandfather grant on every existing shop for the three paywalled SKUs
 * (golden-frijoles-integration · S3.1).
 *
 *   npm run paywall:backfill                 # DRY RUN — reads, plans, writes nothing
 *   npm run paywall:backfill -- --apply      # writes
 *   npm run paywall:backfill -- --sku subdomain [--sku ml_sync]
 *
 * `--dry-run` is the default and stays FULLY read-only: no write, no log append, no
 * network mutation. It is the mode every agent tests with, and a dry run with a side
 * effect is a trap.
 *
 * All of the decision-making lives in `lib/paywall-grandfather.ts` and is unit-tested
 * without a database. This file is the thin I/O shell — read shops, ask the planner,
 * write what it says. Dry-run and apply call the SAME planner, so they cannot
 * disagree about what would happen.
 *
 * A read failure is FATAL and non-zero. A script that exits green having done nothing
 * reads as a passing gate, and this one decides whether real merchants keep access to
 * their own subdomains.
 */
import process from 'node:process'
import { createClient } from '@supabase/supabase-js'
import {
  PAYWALL_SKUS,
  buildGrandfatherGrant,
  grantPatchForShop,
  planGrandfatherBackfill,
  type PaywallSku,
  type ShopForBackfill,
} from '../lib/paywall-grandfather'

type Args = { apply: boolean; skus: PaywallSku[] }

/** Parse argv without adopting anything unrecognised — an unknown flag is fatal. */
export function parseArgs(argv: readonly string[]): { ok: true; args: Args } | { ok: false; error: string } {
  const skus: PaywallSku[] = []
  let apply = false
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--apply') { apply = true; continue }
    if (arg === '--dry-run') { apply = false; continue }
    if (arg === '--sku') {
      const value = argv[i + 1]
      if (!(PAYWALL_SKUS as readonly string[]).includes(value)) {
        return { ok: false, error: `--sku must be one of ${PAYWALL_SKUS.join(', ')} (got ${value ?? 'nothing'})` }
      }
      skus.push(value as PaywallSku)
      i += 1
      continue
    }
    return { ok: false, error: `unknown argument: ${arg}` }
  }
  return { ok: true, args: { apply, skus: skus.length ? skus : [...PAYWALL_SKUS] } }
}

function client() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required — refusing to run blind')
  }
  return createClient(url, key, { auth: { persistSession: false } })
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2))
  if (!parsed.ok) throw new Error(parsed.error)
  const { apply, skus } = parsed.args

  const db = client()
  const { data, error } = await db
    .from('marketplace_shops')
    .select('id, slug, name, metadata')
    .order('created_at', { ascending: true })

  // Three states, never two: a read failure is UNAVAILABLE, not "no shops need a grant".
  if (error) throw new Error(`could not read marketplace_shops: ${error.message}`)
  if (!data) throw new Error('marketplace_shops read returned no result set')

  const shops = data as ShopForBackfill[]
  const plan = planGrandfatherBackfill(shops, skus)
  const grant = buildGrandfatherGrant({ note: 'paywall grandfather backfill' })

  console.log(`[paywall:backfill] ${apply ? 'APPLY' : 'DRY RUN'} — ${shops.length} shop(s), sku(s): ${skus.join(', ')}`)
  for (const sku of skus) {
    console.log(`  ${sku.padEnd(14)} grant ${plan.totals[sku].grant}   skip ${plan.totals[sku].skip}`)
  }

  const owed = plan.decisions.filter((d) => d.action === 'grant')
  for (const decision of owed) {
    console.log(`  + ${decision.sku.padEnd(14)} ${decision.slug ?? decision.shopId}`)
  }

  if (!apply) {
    console.log('[paywall:backfill] dry run — nothing written. Re-run with --apply.')
    return
  }

  let written = 0
  const failures: string[] = []
  for (const shop of shops) {
    const patch = grantPatchForShop(shop, plan.decisions, grant)
    if (!patch) continue
    // `.select()` back: supabase-js reports no error for an UPDATE that matched
    // nothing, so without this an id typo would look like a clean success.
    const { data: updated, error: writeError } = await db
      .from('marketplace_shops')
      .update({ metadata: patch })
      .eq('id', shop.id)
      .select('id')
    if (writeError || !updated?.length) {
      failures.push(`${shop.slug ?? shop.id}: ${writeError?.message ?? 'update matched no row'}`)
      continue
    }
    written += 1
  }

  console.log(`[paywall:backfill] wrote ${written} shop row(s); ${failures.length} failure(s)`)
  for (const failure of failures) console.error(`  ! ${failure}`)

  // A partial apply is a PARTIAL outcome, never a success. The exit code says so.
  if (failures.length) {
    throw new Error(`${failures.length} shop(s) failed — re-run to retry (the backfill is idempotent)`)
  }
}

const invoked = process.argv[1]?.includes('backfill-paywall-grants')
if (invoked) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? `[paywall:backfill] ${error.message}` : '[paywall:backfill] failed')
    process.exitCode = 1
  })
}
