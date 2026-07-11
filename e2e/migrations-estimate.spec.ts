import { test, expect } from '@playwright/test'
import {
  computeMigrationEstimate,
  MIGRATION_BASE_PRICE_CENTS,
  MIGRATION_FLAT_LISTING_CAP,
  MIGRATION_OVERAGE_CENTS_PER_LISTING,
  MIGRATION_SECTION_ADDER_CENTS,
} from '../lib/migration-estimate'

/**
 * Migration estimator · Sprint 2 (epic 03 · platform-migrations, US-2.2).
 *
 * Pure — same inputs ⇒ same breakdown, on every surface. `basePriceCents` is
 * always passed explicitly (not hardcoded inside the function) — the DB-facing
 * caller (lib/migration-estimate-store.ts) reads it from the SAME admin-set
 * price the flat ≤150 close path charges, so the two paths can never disagree
 * (a real cross-review catch: an earlier version hardcoded $999 independently).
 * The real persistence (marketplace_migration_estimates) and the close-from-
 * quote tamper case live in e2e/promoter-close-migration.spec.ts (route-gating
 * only; the real DB round-trip is owed to Daniel, per convention).
 */

test.describe('migration-estimate · computeMigrationEstimate', () => {
  test('at exactly the flat cap (150) — no overage', () => {
    const b = computeMigrationEstimate({ listingCount: MIGRATION_FLAT_LISTING_CAP, customSectionCount: 0, basePriceCents: MIGRATION_BASE_PRICE_CENTS })
    expect(b.overageListings).toBe(0)
    expect(b.overageCents).toBe(0)
    expect(b.totalCents).toBe(MIGRATION_BASE_PRICE_CENTS)
  })

  test('one listing over the cap (151) — first overage unit', () => {
    const b = computeMigrationEstimate({ listingCount: MIGRATION_FLAT_LISTING_CAP + 1, customSectionCount: 0, basePriceCents: MIGRATION_BASE_PRICE_CENTS })
    expect(b.overageListings).toBe(1)
    expect(b.overageCents).toBe(MIGRATION_OVERAGE_CENTS_PER_LISTING)
    expect(b.totalCents).toBe(MIGRATION_BASE_PRICE_CENTS + MIGRATION_OVERAGE_CENTS_PER_LISTING)
  })

  test('200 listings — overage scales linearly per listing beyond 150', () => {
    const b = computeMigrationEstimate({ listingCount: 200, customSectionCount: 0, basePriceCents: MIGRATION_BASE_PRICE_CENTS })
    expect(b.overageListings).toBe(50)
    expect(b.overageCents).toBe(50 * MIGRATION_OVERAGE_CENTS_PER_LISTING)
    expect(b.totalCents).toBe(MIGRATION_BASE_PRICE_CENTS + 50 * MIGRATION_OVERAGE_CENTS_PER_LISTING)
  })

  test('section adders stack per non-mapped section', () => {
    const zero = computeMigrationEstimate({ listingCount: 151, customSectionCount: 0, basePriceCents: MIGRATION_BASE_PRICE_CENTS })
    const two = computeMigrationEstimate({ listingCount: 151, customSectionCount: 2, basePriceCents: MIGRATION_BASE_PRICE_CENTS })
    expect(two.sectionAdderCents).toBe(2 * MIGRATION_SECTION_ADDER_CENTS)
    expect(two.totalCents - zero.totalCents).toBe(2 * MIGRATION_SECTION_ADDER_CENTS)
  })

  test('below the cap still computes a sane (unused-in-practice) answer, no overage', () => {
    const b = computeMigrationEstimate({ listingCount: 40, customSectionCount: 1, basePriceCents: MIGRATION_BASE_PRICE_CENTS })
    expect(b.overageListings).toBe(0)
    expect(b.overageCents).toBe(0)
    expect(b.totalCents).toBe(MIGRATION_BASE_PRICE_CENTS + MIGRATION_SECTION_ADDER_CENTS)
  })

  test('negative/fractional input degrades gracefully, never throws', () => {
    const b = computeMigrationEstimate({ listingCount: -5, customSectionCount: -1, basePriceCents: MIGRATION_BASE_PRICE_CENTS })
    expect(b.overageListings).toBe(0)
    expect(b.sectionAdderCents).toBe(0)
    expect(b.totalCents).toBe(MIGRATION_BASE_PRICE_CENTS)

    const frac = computeMigrationEstimate({ listingCount: 150.9, customSectionCount: 1.9, basePriceCents: MIGRATION_BASE_PRICE_CENTS })
    expect(frac.overageListings).toBe(0) // truncates 150.9 → 150
    expect(frac.sectionAdderCents).toBe(MIGRATION_SECTION_ADDER_CENTS) // truncates 1.9 → 1
  })

  test('determinism — same input twice ⇒ identical breakdown', () => {
    const input = { listingCount: 317, customSectionCount: 3, basePriceCents: MIGRATION_BASE_PRICE_CENTS }
    expect(computeMigrationEstimate(input)).toEqual(computeMigrationEstimate({ ...input }))
  })

  test('the base is whatever is PASSED IN, never a hardcoded internal default — a different admin price changes the total exactly by the difference (a real cross-review catch)', () => {
    const atDefault = computeMigrationEstimate({ listingCount: 200, customSectionCount: 0, basePriceCents: MIGRATION_BASE_PRICE_CENTS })
    const atHigherPrice = computeMigrationEstimate({ listingCount: 200, customSectionCount: 0, basePriceCents: MIGRATION_BASE_PRICE_CENTS + 50_000 })
    expect(atHigherPrice.baseCents).toBe(MIGRATION_BASE_PRICE_CENTS + 50_000)
    expect(atHigherPrice.totalCents - atDefault.totalCents).toBe(50_000)
  })
})
