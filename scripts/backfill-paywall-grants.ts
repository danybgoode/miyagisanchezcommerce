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
import { readGrant } from '../lib/domain-entitlement'
import {
  PAYWALL_SKUS,
  buildGrandfatherGrant,
  planGrandfatherBackfill,
  writeStepsForShop,
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
      // Deduplicate: a repeated --sku would otherwise plan the same shop twice and
      // report two grants where one write happens, making the totals lie.
      if (!skus.includes(value as PaywallSku)) skus.push(value as PaywallSku)
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
  // Zero shops is not "nothing to do" — this platform has shops. An empty read means
  // the credentials point somewhere else (an empty project, the wrong environment),
  // and reporting a green run for it is exactly the confident falsehood that makes a
  // backfill read as a passing gate. Refuse rather than succeed at nothing.
  if (data.length === 0) {
    throw new Error('marketplace_shops is empty — refusing to report success against a project with no shops')
  }

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
  let repaired = 0
  let raced = 0
  const failures: string[] = []
  for (const shop of shops) {
    if (!plan.decisions.some((d) => d.shopId === shop.id && d.action === 'grant')) continue

    // RE-READ before writing. The merge itself is atomic, so this is not about
    // clobbering — it decides WHICH guard each step uses. A key that was absent in
    // the opening snapshot but is present now must be guarded on absence (or
    // skipped), and a key that is present-but-malformed is repaired by
    // compare-and-swap against the exact value read here. Deciding that from a stale
    // snapshot would pick the wrong guard, or swap against a value that moved.
    const { data: fresh, error: reReadError } = await db
      .from('marketplace_shops')
      .select('id, slug, name, metadata')
      .eq('id', shop.id)
      .maybeSingle()
    if (reReadError || !fresh) {
      failures.push(`${shop.slug ?? shop.id}: re-read failed (${reReadError?.message ?? 'row disappeared'})`)
      continue
    }

    // Re-plan against the fresh row: a grant that appeared since the snapshot makes
    // that SKU owe nothing, and it must NOT be overwritten with a grandfather one.
    const freshPlan = planGrandfatherBackfill([fresh as ShopForBackfill], skus)
    const owed = freshPlan.decisions.filter((d) => d.action === 'grant')
    if (owed.length === 0) {
      // Count per SKU, not per shop. The guard-triggered path below increments once
      // per SKU, so incrementing once here would undercount exactly the case where
      // every owed SKU was granted concurrently before the re-read.
      raced += plan.decisions.filter((d) => d.shopId === shop.id && d.action === 'grant').length
      continue
    }

    // ONE MERGE PER SKU, server-side. `merge_shop_metadata` does `metadata || patch`
    // inside the UPDATE, so a concurrent change to an unrelated key (settings, theme,
    // a domain) survives — a read-modify-write of the whole object would revert it.
    // Per-SKU rather than combined, so one concurrently-granted SKU cannot block the
    // rest.
    for (const step of writeStepsForShop(fresh as ShopForBackfill, freshPlan.decisions)) {
      const { data: merged, error: writeError } = await db.rpc('merge_shop_metadata', {
        p_shop_id: shop.id,
        p_patch: { [step.key]: grant },
        p_guard_key: step.guard.key,
        p_guard_mode: step.guard.mode,
        p_expected: step.guard.mode === 'equals' ? step.guard.expected : null,
      })
      if (writeError) {
        failures.push(`${shop.slug ?? shop.id} (${step.sku}): ${writeError.message}`)
        continue
      }

      if (Array.isArray(merged) && merged.length > 0) {
        if (step.kind === 'repair') repaired += 1
        else written += 1
        continue
      }

      // Zero rows means the guard fired: the key appeared, or changed, between the
      // re-read and now. That is only SAFE if what is there now actually entitles the
      // shop — so verify instead of assuming. A value that is present but still
      // refused by `readGrant` leaves the shop unentitled, which is a failure that
      // needs a human, not a quiet "skipped, granted concurrently".
      const { data: after, error: verifyError } = await db
        .from('marketplace_shops')
        .select('metadata')
        .eq('id', shop.id)
        .maybeSingle()
      if (verifyError || !after) {
        failures.push(`${shop.slug ?? shop.id} (${step.sku}): could not verify after a refused merge`)
        continue
      }
      if (readGrant((after as { metadata: unknown }).metadata, step.key)) raced += 1
      else failures.push(`${shop.slug ?? shop.id} (${step.sku}): key present but still not a valid grant`)
    }
  }

  console.log(
    `[paywall:backfill] granted ${written}; repaired ${repaired} malformed; ` +
      `${raced} skipped (already granted concurrently); ${failures.length} failed write(s)`,
  )
  for (const failure of failures) console.error(`  ! ${failure}`)

  // A partial apply is a PARTIAL outcome, never a success. The exit code says so.
  if (failures.length) {
    // Counted per WRITE, not per shop: one shop can fail on two SKUs.
    throw new Error(`${failures.length} write(s) failed — re-run to retry (the backfill is idempotent)`)
  }
}

const invoked = process.argv[1]?.includes('backfill-paywall-grants')
if (invoked) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? `[paywall:backfill] ${error.message}` : '[paywall:backfill] failed')
    process.exitCode = 1
  })
}
