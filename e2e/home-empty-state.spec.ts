import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

/**
 * The market home's empty state must mean the WHOLE page is empty.
 *
 * On the day /us got its first listing — one uncategorised product — the page
 * rendered "The marketplace is taking shape / The first listings will appear here
 * soon" directly BENEATH that listing. `seleccion` and `categories` were both empty
 * while the new-arrivals row was not, and the condition only tested the first two.
 *
 * MX never exposed it because MX always has categories; the original code comment
 * even read "marketplace non-empty today". A branch that only the newest market can
 * reach is exactly the branch no one checks, so it gets a spec.
 *
 * Source-level because the condition is a server render over three live datasets —
 * pinning the predicate is what stops it silently losing a term again.
 */

const ROOT = path.join(import.meta.dirname, '..')
const HOME = fs.readFileSync(path.join(ROOT, 'app/(mx-site)/mx/page.tsx'), 'utf8')

/** The three collections that can put content on the market home. */
const HOME_COLLECTIONS = ['seleccion', 'categories', 'recienLlegado'] as const

test.describe('market home · the empty state means the page is empty', () => {
  test('every home collection is part of the empty-state predicate', () => {
    const condition = HOME.match(/\{([^}]*?)&&\s*\(\s*\n\s*<div className="text-center py-16"/)
    expect(condition, 'the empty-state condition must still be findable').toBeTruthy()

    const predicate = condition![1]
    for (const collection of HOME_COLLECTIONS) {
      expect(predicate, `${collection} must be part of the empty-state test`).toContain(collection)
    }
  })

  test('the predicate tests emptiness, not presence', () => {
    const condition = HOME.match(/\{([^}]*?)&&\s*\(\s*\n\s*<div className="text-center py-16"/)
    const predicate = condition![1]
    // Each term must be a `.length === 0` check; `> 0` anywhere would invert it.
    for (const collection of HOME_COLLECTIONS) {
      expect(predicate).toMatch(new RegExp(`${collection}\\.length === 0`))
    }
    expect(predicate).not.toContain('.length > 0')
  })

  test('the new-arrivals row still renders from recienLlegado', () => {
    // If this variable is renamed, the guard above would pass vacuously against a
    // predicate that no longer refers to the row the user actually sees.
    expect(HOME).toContain('const recienLlegado =')
  })
})
