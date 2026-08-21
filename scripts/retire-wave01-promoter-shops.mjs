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

const APPLY = process.argv.includes('--apply')
const NAMES = ['Kokone', 'Kaab', 'Curated Basics', 'Concrete Garden Candles']
const RETIRED_SUFFIX = '-preview-retired-20260820'
const MAX_SELLER_SLUG_LENGTH = 40

/**
 * Refuse ambiguity rather than silently retiring a subset. The old previews are
 * audit history; their precise provenance is the only safe discriminator.
 */
export function selectRetirementTargets(rows) {
  const failures = []
  const targets = []

  for (const name of NAMES) {
    const matches = rows.filter((row) => row?.name === name)
    if (matches.length !== 1) {
      failures.push(`${name}: expected exactly one mirror row, found ${matches.length}`)
      continue
    }

    const row = matches[0]
    if (row.clerk_user_id != null) {
      failures.push(`${name}: REFUSE claimed shop`)
      continue
    }
    if (typeof row.source_url !== 'string' || !row.source_url.toLowerCase().startsWith('promoter://')) {
      failures.push(`${name}: REFUSE non-promoter provenance (${String(row.source_url)})`)
      continue
    }
    if (typeof row.slug !== 'string' || !row.slug.trim()) {
      failures.push(`${name}: REFUSE missing mirror slug`)
      continue
    }
    const sellerId = row.metadata?.medusa_seller_id
    if (typeof sellerId !== 'string' || !sellerId.startsWith('sel_')) {
      failures.push(`${name}: REFUSE mirror has no canonical Medusa seller id`)
      continue
    }
    const retiredSlug = row.slug.endsWith(RETIRED_SUFFIX)
      ? row.slug
      : `${row.slug.slice(0, Math.max(1, MAX_SELLER_SLUG_LENGTH - RETIRED_SUFFIX.length))}${RETIRED_SUFFIX}`
    targets.push({ row, sellerId, retiredSlug })
  }

  if (failures.length) {
    throw new Error(`Wave 01 retirement refused:\n${failures.map((failure) => `- ${failure}`).join('\n')}`)
  }
  return targets
}

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

async function retireTarget({ row, sellerId, retiredSlug }, status, medusa, secret, db) {
  if (status === 'deleted' && row.slug !== retiredSlug) {
    throw new Error(`${row.name}: REFUSE deleted seller whose mirror still has the public slug`)
  }
  if (status === 'deleted') return

  if (row.slug !== retiredSlug) {
    const { res: slugRes, body: slugBody } = await fetchJson(`${medusa}/internal/sellers/slug`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
      body: JSON.stringify({ seller_slug: row.slug, new_slug: retiredSlug }),
    })
    if (!slugRes.ok) throw new Error(`${row.name}: slug retire failed ${slugRes.status}: ${slugBody.message ?? ''}`)
    if (slugBody.seller_slug !== retiredSlug) throw new Error(`${row.name}: slug retire returned an unexpected slug`)
  }

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
    .in('name', NAMES)
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
