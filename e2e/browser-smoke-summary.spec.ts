import { test, expect } from '@playwright/test'
import { authCredentialState, buildSummary } from '../scripts/browser-smoke-summary.mjs'

/**
 * Guards the three states of the credentialed browser-smoke layer.
 *
 * "Off" and "asked for but missing" printed the same sentence for months, which is
 * how `ci.yml` mapping two secret names that do not exist stayed invisible: GitHub
 * resolves a missing secret to an empty string, `authEnabled()` went false, 29 authed
 * tests skipped, and the summary reported it as the ordinary anonymous state.
 */

const REPORT = { skippedAuthedTests: 29, skippedAuthedSpecFiles: 15, missingFixtures: {} }

test.describe('browser-smoke summary', () => {
  test('auth off is "off", not "unavailable"', () => {
    expect(authCredentialState({})).toEqual({ state: 'off', missing: [] })
    // The keys being present is irrelevant when nobody asked for authed smokes.
    expect(authCredentialState({ CLERK_PUBLISHABLE_KEY: 'pk', CLERK_SECRET_KEY: 'sk' }).state).toBe('off')
  })

  test('requested with both keys is "on"', () => {
    expect(
      authCredentialState({ MS_TEST_BROWSER_AUTH: '1', CLERK_PUBLISHABLE_KEY: 'pk', CLERK_SECRET_KEY: 'sk' }),
    ).toEqual({ state: 'on', missing: [] })
  })

  test('requested with an empty key is "unavailable", and names which one', () => {
    // The exact production shape: the flag is set, the secret name in the workflow
    // does not exist, so the value arrives as ''.
    const state = authCredentialState({ MS_TEST_BROWSER_AUTH: '1', CLERK_PUBLISHABLE_KEY: '', CLERK_SECRET_KEY: '' })
    expect(state.state).toBe('unavailable')
    expect(state.missing).toEqual(['CLERK_PUBLISHABLE_KEY', 'CLERK_SECRET_KEY'])

    const one = authCredentialState({ MS_TEST_BROWSER_AUTH: '1', CLERK_PUBLISHABLE_KEY: 'pk' })
    expect(one.state).toBe('unavailable')
    expect(one.missing).toEqual(['CLERK_SECRET_KEY'])
  })

  test('the unavailable summary warns and names the empty secrets', () => {
    const summary = buildSummary(REPORT, { MS_TEST_BROWSER_AUTH: '1' })
    expect(summary).toContain('WARNING')
    expect(summary).toContain('REQUESTED but could not run')
    expect(summary).toContain('CLERK_PUBLISHABLE_KEY')
    expect(summary).toContain('CLERK_SECRET_KEY')
  })

  test('the off and on summaries do NOT warn — the negation stays available', () => {
    // A summary that warned on every run would be ignored within a week, which is the
    // same failure as never warning at all.
    for (const env of [{}, { MS_TEST_BROWSER_AUTH: '1', CLERK_PUBLISHABLE_KEY: 'pk', CLERK_SECRET_KEY: 'sk' }]) {
      const summary = buildSummary(REPORT, env)
      expect(summary).not.toContain('WARNING')
      expect(summary).toContain('Authed tests skipped: **29**')
    }
  })

  test('missing fixtures are tabulated by name, never by value', () => {
    const summary = buildSummary(
      { ...REPORT, missingFixtures: { MS_TEST_SHIPPABLE_LISTING_ID: ['a', 'b'] } },
      {},
    )
    expect(summary).toContain('| `MS_TEST_SHIPPABLE_LISTING_ID` | 2 |')
  })
})
