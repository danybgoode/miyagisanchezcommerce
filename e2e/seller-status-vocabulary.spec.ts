/**
 * The storefront's seller-status vocabulary must match the backend's
 * (tenant-lifecycle-admin · D1).
 *
 * Medusa owns the seller, so `apps/backend/src/lib/seller-status.ts` is the
 * authoritative definition. These are separate repositories with separate deploys, so
 * the storefront carries a copy of the value list — and a copy that nobody checks is
 * the paraphrased contract that drifts permissive, which this codebase records as
 * having bitten it five times.
 *
 * This spec reads the backend's own source and asserts the lists agree. If the
 * backend adds a state, this goes red here rather than the admin silently rendering
 * an unknown status as a blank cell.
 *
 * It SKIPS when the sibling repo is absent (CI clones this repo alone), because a
 * spec that fails for being unable to look is a spec people learn to ignore — but it
 * says so out loud rather than passing quietly.
 */
import { test, expect } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SELLER_STATUSES, parseSellerStatus, sellerStatusLabel } from '../lib/seller-status'

const BACKEND_SOURCE = join(process.cwd(), '..', 'backend', 'src', 'lib', 'seller-status.ts')

test.describe('seller status vocabulary', () => {
  test('matches the backend definition, or says why it could not check', () => {
    if (!existsSync(BACKEND_SOURCE)) {
      // Three states, never two: "checked and matched", "checked and differs", and
      // "could not check". Announce the third rather than passing silently.
      console.warn(
        `[seller-status-vocabulary] SKIPPED — ${BACKEND_SOURCE} not present. ` +
          'This runs in a full monorepo checkout; CI clones this repo alone.',
      )
      test.skip()
      return
    }
    const source = readFileSync(BACKEND_SOURCE, 'utf8')
    const match = source.match(/export const SELLER_STATUSES = \[([^\]]+)\]/)
    expect(match, 'backend SELLER_STATUSES not found — did it move or get renamed?').toBeTruthy()
    const backendValues = [...(match?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
    expect(backendValues).toEqual([...SELLER_STATUSES])
  })

  test('every status has a distinct es-MX label', () => {
    const labels = SELLER_STATUSES.map((status) => sellerStatusLabel(status))
    expect(new Set(labels).size).toBe(labels.length)
    for (const label of labels) expect(label.length).toBeGreaterThan(0)
  })

  test('an unreadable status renders as unavailable, NEVER as active', () => {
    // The admin is where an operator decides whether to intervene. Showing "Activa"
    // for a shop whose status we could not read is a confident falsehood on exactly
    // the wrong screen.
    expect(parseSellerStatus(undefined)).toBeNull()
    expect(parseSellerStatus('suspended')).toBeNull()
    expect(sellerStatusLabel(null)).toBe('No disponible')
    expect(sellerStatusLabel(null)).not.toBe(sellerStatusLabel('active'))
  })
})
