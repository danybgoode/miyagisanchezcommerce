/**
 * The paywall grandfather backfill's decision logic
 * (golden-frijoles-integration · S3.1).
 *
 * Everything asserted here is pure — the planner takes shop rows and returns
 * decisions, so the interesting behaviour (idempotence, the expired-one_time case,
 * per-SKU isolation) is testable without touching production data. That separation
 * is the point: the live run is a thin write around exactly this function, so a
 * green suite here means `--dry-run` and `--apply` cannot disagree.
 */
import { test, expect } from '@playwright/test'
import {
  PAYWALL_GRANT_KEY,
  PAYWALL_SKUS,
  buildGrandfatherGrant,
  grantPatchForShop,
  planGrandfatherBackfill,
  writeStepsForShop,
  type ShopForBackfill,
} from '../lib/paywall-grandfather'
import { parseArgs } from '../scripts/backfill-paywall-grants'

const shop = (id: string, metadata: Record<string, unknown> | null = null): ShopForBackfill => ({
  id, slug: id, name: id, metadata,
})

const grandfather = { type: 'grandfather' as const, granted_at: '2026-07-01T00:00:00.000Z' }
const comp = { type: 'comp' as const, granted_at: '2026-07-01T00:00:00.000Z' }

test.describe('buildGrandfatherGrant', () => {
  test('produces the shape readGrant parses and deriveDomainEntitlement honors', () => {
    const grant = buildGrandfatherGrant({ now: new Date('2026-08-14T00:00:00.000Z') })
    expect(grant.type).toBe('grandfather')
    expect(grant.granted_at).toBe('2026-08-14T00:00:00.000Z')
    expect(grant.expires_at).toBeUndefined() // permanent — only one_time lapses
  })

  test('a blank note is dropped rather than stored empty', () => {
    expect(buildGrandfatherGrant({ note: '   ' }).note).toBeUndefined()
    expect(buildGrandfatherGrant({ note: ' cutover ' }).note).toBe('cutover')
  })
})

test.describe('planGrandfatherBackfill', () => {
  test('a shop with no metadata is owed every SKU', () => {
    const plan = planGrandfatherBackfill([shop('a')])
    expect(plan.decisions).toHaveLength(PAYWALL_SKUS.length)
    expect(plan.decisions.every((d) => d.action === 'grant')).toBe(true)
    for (const sku of PAYWALL_SKUS) expect(plan.totals[sku]).toEqual({ grant: 1, skip: 0 })
  })

  test('an existing grant is skipped — this is what makes a second run a no-op', () => {
    const granted = shop('a', { [PAYWALL_GRANT_KEY.subdomain]: grandfather })
    const plan = planGrandfatherBackfill([granted], ['subdomain'])
    expect(plan.totals.subdomain).toEqual({ grant: 0, skip: 1 })
    expect(plan.decisions[0].reason).toBe('existing_grant')
    expect(plan.decisions[0].existing?.type).toBe('grandfather')
  })

  test('re-running over the applied result grants nothing — idempotence, end to end', () => {
    const before = [shop('a'), shop('b', { [PAYWALL_GRANT_KEY.subdomain]: comp })]
    const grant = buildGrandfatherGrant({ now: new Date('2026-08-14T00:00:00.000Z') })
    const first = planGrandfatherBackfill(before)

    // Apply the plan the way the script does, then re-plan over the result.
    const after = before.map((s) => {
      const patch = grantPatchForShop(s, first.decisions, grant)
      return patch ? { ...s, metadata: patch } : s
    })
    const second = planGrandfatherBackfill(after)

    expect(second.decisions.every((d) => d.action === 'skip')).toBe(true)
    for (const sku of PAYWALL_SKUS) expect(second.totals[sku].grant).toBe(0)
  })

  test('SKUs are isolated — granting one never covers another', () => {
    const partial = shop('a', { [PAYWALL_GRANT_KEY.subdomain]: grandfather })
    const plan = planGrandfatherBackfill([partial])
    expect(plan.totals.subdomain).toEqual({ grant: 0, skip: 1 })
    expect(plan.totals.custom_domain).toEqual({ grant: 1, skip: 0 })
    expect(plan.totals.ml_sync).toEqual({ grant: 1, skip: 0 })
  })

  test('an EXPIRED one_time grant is skipped, not converted to a permanent one', () => {
    // A lapsed one_time means the shop bought a term that ran out. Absorbing it into
    // a grandfather grant would hand back a paid SKU for free, silently. It must stay
    // visible as a skip so a human decides.
    const lapsed = shop('a', {
      [PAYWALL_GRANT_KEY.subdomain]: {
        type: 'one_time',
        granted_at: '2025-01-01T00:00:00.000Z',
        expires_at: '2026-01-01T00:00:00.000Z',
      },
    })
    const plan = planGrandfatherBackfill([lapsed], ['subdomain'])
    expect(plan.totals.subdomain).toEqual({ grant: 0, skip: 1 })
    expect(plan.decisions[0].existing?.type).toBe('one_time')
  })

  test('a MALFORMED grant is not a grant — the shop is granted rather than left unprotected', () => {
    // readGrant refuses a one_time with no expires_at. Treating that as "has a grant"
    // would leave a shop paywalled with a grant-shaped object that entitles nobody.
    const malformed = shop('a', {
      [PAYWALL_GRANT_KEY.subdomain]: { type: 'one_time', granted_at: '2026-01-01T00:00:00.000Z' },
    })
    const plan = planGrandfatherBackfill([malformed], ['subdomain'])
    expect(plan.totals.subdomain).toEqual({ grant: 1, skip: 0 })
  })

  test('restricting the SKU list decides only those SKUs', () => {
    const plan = planGrandfatherBackfill([shop('a')], ['subdomain'])
    expect(plan.decisions).toHaveLength(1)
    expect(plan.totals.subdomain.grant).toBe(1)
    expect(plan.totals.custom_domain).toEqual({ grant: 0, skip: 0 })
  })

  test('an empty shop list plans nothing and reports zero — never a confident empty success', () => {
    const plan = planGrandfatherBackfill([])
    expect(plan.decisions).toEqual([])
    for (const sku of PAYWALL_SKUS) expect(plan.totals[sku]).toEqual({ grant: 0, skip: 0 })
  })
})

test.describe('grantPatchForShop', () => {
  test('returns null when nothing is owed, so no no-op UPDATE is issued', () => {
    const granted = shop('a', Object.fromEntries(PAYWALL_SKUS.map((s) => [PAYWALL_GRANT_KEY[s], grandfather])))
    const plan = planGrandfatherBackfill([granted])
    expect(grantPatchForShop(granted, plan.decisions, buildGrandfatherGrant())).toBeNull()
  })

  test('preserves unrelated metadata — a grant must never clobber shop settings', () => {
    const withSettings = shop('a', { settings: { stripe: { enabled: true } }, theme: 'dark' })
    const plan = planGrandfatherBackfill([withSettings], ['subdomain'])
    const patch = grantPatchForShop(withSettings, plan.decisions, buildGrandfatherGrant())
    expect(patch?.settings).toEqual({ stripe: { enabled: true } })
    expect(patch?.theme).toBe('dark')
    expect(patch?.[PAYWALL_GRANT_KEY.subdomain]).toMatchObject({ type: 'grandfather' })
  })

  test('writes only the SKUs the plan owes this shop', () => {
    const partial = shop('a', { [PAYWALL_GRANT_KEY.subdomain]: comp })
    const plan = planGrandfatherBackfill([partial])
    const patch = grantPatchForShop(partial, plan.decisions, buildGrandfatherGrant())
    expect(patch?.[PAYWALL_GRANT_KEY.subdomain]).toMatchObject({ type: 'comp' }) // untouched
    expect(patch?.[PAYWALL_GRANT_KEY.custom_domain]).toMatchObject({ type: 'grandfather' })
    expect(patch?.[PAYWALL_GRANT_KEY.ml_sync]).toMatchObject({ type: 'grandfather' })
  })

  test('another shop\'s decisions never leak into this shop\'s patch', () => {
    const a = shop('a')
    const b = shop('b')
    const plan = planGrandfatherBackfill([a, b])
    const patch = grantPatchForShop(a, plan.decisions, buildGrandfatherGrant())
    // 3 SKUs for shop a only — not 6.
    expect(Object.keys(patch ?? {})).toHaveLength(PAYWALL_SKUS.length)
  })
})

test.describe('parseArgs', () => {
  test('defaults to a dry run over every SKU — the safe default is the default', () => {
    const parsed = parseArgs([])
    expect(parsed.ok && parsed.args.apply).toBe(false)
    expect(parsed.ok && parsed.args.skus).toEqual([...PAYWALL_SKUS])
  })

  test('--apply opts in, and --dry-run opts back out', () => {
    const applied = parseArgs(['--apply'])
    expect(applied.ok && applied.args.apply).toBe(true)
    const both = parseArgs(['--apply', '--dry-run'])
    expect(both.ok && both.args.apply).toBe(false)
  })

  test('a repeated --sku is deduplicated, so the totals cannot double-count', () => {
    const parsed = parseArgs(['--sku', 'subdomain', '--sku', 'subdomain'])
    expect(parsed.ok && parsed.args.skus).toEqual(['subdomain'])
  })

  test('an unknown sku is refused, not coerced', () => {
    expect(parseArgs(['--sku', 'envia']).ok).toBe(false)
    expect(parseArgs(['--sku']).ok).toBe(false)
  })

  test('an unknown flag is fatal rather than ignored', () => {
    expect(parseArgs(['--force']).ok).toBe(false)
  })
})

test.describe('writeStepsForShop', () => {
  test('an ABSENT key is guarded on its own absence, so a concurrent grant is never overwritten', () => {
    const plan = planGrandfatherBackfill([shop('a')], ['subdomain'])
    const [step] = writeStepsForShop(shop('a'), plan.decisions)
    expect(step.kind).toBe('grant')
    expect(step.guard).toEqual({ key: PAYWALL_GRANT_KEY.subdomain, mode: 'absent' })
  })

  test('a MALFORMED key is repaired by COMPARE-AND-SWAP against the exact bad value', () => {
    // This is the round-2 blocker in one assertion. readGrant refuses a one_time
    // with no expires_at, so the planner owes this shop a grant; a presence guard
    // would match zero rows and leave it unentitled while the dry run promised a fix.
    const malformed = shop('a', {
      [PAYWALL_GRANT_KEY.subdomain]: { type: 'one_time', granted_at: '2026-01-01T00:00:00.000Z' },
    })
    const plan = planGrandfatherBackfill([malformed], ['subdomain'])
    const [step] = writeStepsForShop(malformed, plan.decisions)
    expect(step.kind).toBe('repair')
    // Not an absence guard (it would reject the row we came to fix) and not
    // unguarded (that could overwrite a valid grant that landed in between).
    expect(step.guard).toEqual({
      key: PAYWALL_GRANT_KEY.subdomain,
      mode: 'equals',
      expected: { type: 'one_time', granted_at: '2026-01-01T00:00:00.000Z' },
    })
  })

  test('each owed SKU gets its OWN step, so one concurrent grant cannot block the rest', () => {
    // The other round-2 blocker: a single combined write guarded on every owed key
    // matches zero rows the moment any one of them is granted elsewhere.
    const steps = writeStepsForShop(shop('a'), planGrandfatherBackfill([shop('a')]).decisions)
    expect(steps).toHaveLength(PAYWALL_SKUS.length)
    expect(new Set(steps.map((s) => s.key)).size).toBe(PAYWALL_SKUS.length)
  })

  test('a key holding JSON null gets its OWN mode — absent and json-null are different states', () => {
    // The round-5 blocker in one assertion. TypeScript sees `null` and would call it
    // absent; SQL's `?` sees the key and calls it present. Guarding on absence
    // therefore matched zero rows and the shop could never be repaired, on every
    // retry, forever. The mode is stated so the two cannot disagree.
    const jsonNull = shop('a', { [PAYWALL_GRANT_KEY.subdomain]: null })
    const plan = planGrandfatherBackfill([jsonNull], ['subdomain'])
    expect(plan.totals.subdomain).toEqual({ grant: 1, skip: 0 })
    const [step] = writeStepsForShop(jsonNull, plan.decisions)
    expect(step.kind).toBe('repair')
    expect(step.guard).toEqual({ key: PAYWALL_GRANT_KEY.subdomain, mode: 'json_null' })
  })

  test('a shop owed nothing produces no steps at all', () => {
    const granted = shop('a', Object.fromEntries(PAYWALL_SKUS.map((s) => [PAYWALL_GRANT_KEY[s], grandfather])))
    expect(writeStepsForShop(granted, planGrandfatherBackfill([granted]).decisions)).toEqual([])
  })

  test("another shop's decisions never produce steps for this shop", () => {
    const a = shop('a')
    const plan = planGrandfatherBackfill([a, shop('b')])
    expect(writeStepsForShop(a, plan.decisions)).toHaveLength(PAYWALL_SKUS.length)
  })
})
