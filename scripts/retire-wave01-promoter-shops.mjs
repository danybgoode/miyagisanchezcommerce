#!/usr/bin/env node
/**
 * One-time correction for Wave 01 promoter/private-preview shops.
 *
 * DRY-RUN by default. With --apply it accepts exactly one row for every
 * expected shop: unclaimed and with promoter:// provenance. It retires the
 * Medusa seller, frees the public slug, then updates the Supabase mirror so a
 * replacement Gem import cannot attach to the old mirror by slug.
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MEDUSA_STORE_URL,
 * MEDUSA_INTERNAL_SECRET.
 *
 * Usage:
 *   node --env-file=.env.local scripts/retire-wave01-promoter-shops.mjs
 *   node --env-file=.env.local scripts/retire-wave01-promoter-shops.mjs --apply
 */
import { createClient } from '@supabase/supabase-js'
import {
  planWave01Retirement,
  selectRetirementTargets,
  WAVE01_NAMES,
} from './lib/wave01-promoter-retirement.mjs'

const APPLY = process.argv.includes('--apply')
async function fetchJson(url, options) {
  const res = await fetch(url, options)
  const body = await res.json().catch(() => ({}))
  return { res, body }
}

async function readLiveStatuses(targets, medusa, secret) {
  const statuses = new Map()
  for (const { row, sellerId } of targets) {
    const { res, body } = await fetchJson(`${medusa}/internal/sellers/${encodeURIComponent(sellerId)}/status`, {
      headers: { 'x-internal-secret': secret },
    })
    if (!res.ok) throw new Error(`${row.name}: status read failed ${res.status}`)
    if (body.readable === false) throw new Error(`${row.name}: REFUSE unreadable seller status`)
    statuses.set(sellerId, body.status)
  }
  return statuses
}

async function ensureRetiredSellerSlug({ row, retiredSlug }, medusa, secret) {
  if (row.slug === retiredSlug) return
  const { res: slugRes, body: slugBody } = await fetchJson(`${medusa}/internal/sellers/slug`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
    body: JSON.stringify({ seller_slug: row.slug, new_slug: retiredSlug }),
  })
  if (slugRes.ok) {
    if (slugBody.seller_slug !== retiredSlug) throw new Error(`${row.name}: slug retire returned an unexpected slug`)
    return
  }
  if (slugRes.status !== 404) throw new Error(`${row.name}: slug retire failed ${slugRes.status}: ${slugBody.message ?? ''}`)

  // A prior run may have renamed the Medusa seller before failing to update its
  // mirror. Prove that exact deterministic slug via the backend's no-op path;
  // never trust the mirror to answer a Medusa-ownership question.
  const { res: probeRes, body: probeBody } = await fetchJson(`${medusa}/internal/sellers/slug`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
    body: JSON.stringify({ seller_slug: retiredSlug, new_slug: retiredSlug }),
  })
  if (!probeRes.ok || probeBody.seller_slug !== retiredSlug) {
    throw new Error(`${row.name}: cannot prove the seller already holds the retired slug after ${slugRes.status}`)
  }
}

async function retireTarget({ row, sellerId, retiredSlug }, status, medusa, secret, db) {
  const plan = planWave01Retirement({ mirrorSlug: row.slug, retiredSlug, sellerStatus: status })
  if (plan.ensureSellerSlug) await ensureRetiredSellerSlug({ row, retiredSlug }, medusa, secret)

  if (plan.retireSeller) {
    const { res: statusRes, body: statusBody } = await fetchJson(`${medusa}/internal/sellers/${encodeURIComponent(sellerId)}/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
      body: JSON.stringify({
        status: 'deleted',
        reason: 'Wave 01 correction: replaced promoter/private preview with public Gem import',
      }),
    })
    if (!statusRes.ok) throw new Error(`${row.name}: retire status failed ${statusRes.status}: ${statusBody.message ?? ''}`)
    if (statusBody.complete === false || statusBody.status_changed === false) {
      throw new Error(`${row.name}: retire was partial; inspect backend response before importing replacement`)
    }
  }

  if (!plan.updateMirrorSlug) return
  const { error: mirrorError, count } = await db
    .from('marketplace_shops')
    .update({ slug: retiredSlug, updated_at: new Date().toISOString() }, { count: 'exact' })
    .eq('id', row.id)
    .is('clerk_user_id', null)
  if (mirrorError) throw mirrorError
  if (count !== 1) throw new Error(`${row.name}: mirror slug update matched ${count ?? 0} rows`)
}

async function main() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const medusa = (process.env.MEDUSA_STORE_URL ?? '').replace(/\/$/, '')
  const secret = process.env.MEDUSA_INTERNAL_SECRET
  if (!url || !key || !medusa || !secret) throw new Error('Missing required env; see file header.')
  const db = createClient(url, key)

  const { data: rows, error } = await db
    .from('marketplace_shops')
    .select('id,slug,name,source_url,clerk_user_id,metadata')
    .in('name', WAVE01_NAMES)
  if (error) throw error

  const targets = selectRetirementTargets(rows ?? [])
  console.log(`${APPLY ? 'APPLY' : 'DRY-RUN'}: found ${targets.length} exact promoter-created, unclaimed Wave 01 shop(s).`)
  for (const { row, sellerId, retiredSlug } of targets) {
    console.log(`- ${row.name}: ${row.slug} -> ${retiredSlug} (${sellerId})`)
  }
  if (!APPLY) {
    console.log('No mutations performed. Re-run with --apply only after verifying every row above is the Wave 01 promoter preview.')
    return
  }

  // Validate all seller states before the first write; a bad target must not
  // leave an earlier target half-retired just because it appeared first.
  const statuses = await readLiveStatuses(targets, medusa, secret)
  for (const target of targets) await retireTarget(target, statuses.get(target.sellerId), medusa, secret, db)
  console.log('Retirement complete. Historical preview/attribution rows are retained for audit; only seller lifecycle + slug changed.')
}

await main()
