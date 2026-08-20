import { test, expect } from '@playwright/test'
import { onVercelPreview, targetBaseURL, CLIENT_JS_UNAVAILABLE_ON_PREVIEW } from './_helpers/target'

/**
 * Guards `_helpers/target.ts`, which decides whether a spec is allowed to skip.
 *
 * A skip is the most dangerous thing in a suite: it reads as "fine" in every summary.
 * Two of these specs exist because the WRONG answer here is silent — if
 * `onVercelPreview()` ever returned true against production, `home-personalization`
 * and `agent-prompt` would stop testing anything at all and nothing would say so.
 * So the negative cases are asserted at least as hard as the positive one.
 */

function withBaseURL<T>(value: string | undefined, fn: () => T): T {
  const previous = process.env.PLAYWRIGHT_BASE_URL
  if (value === undefined) delete process.env.PLAYWRIGHT_BASE_URL
  else process.env.PLAYWRIGHT_BASE_URL = value
  try {
    return fn()
  } finally {
    if (previous === undefined) delete process.env.PLAYWRIGHT_BASE_URL
    else process.env.PLAYWRIGHT_BASE_URL = previous
  }
}

test.describe('target helper', () => {
  test('a vercel.app host IS a preview', () => {
    for (const url of [
      'https://miyagisanchez-invbc06d6-danybgoodes-projects.vercel.app',
      'https://anything.vercel.app/some/path',
      'http://miyagisanchez-abc.vercel.app',
    ]) {
      expect(withBaseURL(url, onVercelPreview), url).toBe(true)
    }
  })

  test('production, localhost and the default are NOT previews', () => {
    // The load-bearing half. A false positive here silently deletes coverage.
    for (const url of [
      'https://miyagisanchez.com',
      'https://miyagisanchez.com/mx',
      'http://localhost:3001',
      'https://mschz.org',
    ]) {
      expect(withBaseURL(url, onVercelPreview), url).toBe(false)
    }
    expect(withBaseURL(undefined, onVercelPreview), 'unset env must default to production').toBe(false)
  })

  test('a hostname that merely CONTAINS vercel.app is not a preview', () => {
    // Anchored on the end of the hostname, so a lookalike domain cannot switch the
    // suite into skip mode.
    for (const url of ['https://vercel.app.example.com', 'https://notvercel.app.evil.test']) {
      expect(withBaseURL(url, onVercelPreview), url).toBe(false)
    }
  })

  test('a malformed base URL runs the specs rather than skipping them', () => {
    // A typo in an env var must never be able to turn a whole layer green-by-skip.
    expect(withBaseURL('not a url at all', onVercelPreview)).toBe(false)
    expect(withBaseURL('', onVercelPreview)).toBe(false)
  })

  test('targetBaseURL reports the configured target, defaulting to production', () => {
    expect(withBaseURL('https://x.vercel.app', targetBaseURL)).toBe('https://x.vercel.app')
    expect(withBaseURL(undefined, targetBaseURL)).toBe('https://miyagisanchez.com')
  })

  test('the skip reason names the cause and where the coverage actually lives', () => {
    // A skip nobody can act on is noise; this asserts the message stays diagnostic.
    expect(CLIENT_JS_UNAVAILABLE_ON_PREVIEW).toContain('x-vercel-protection-bypass')
    expect(CLIENT_JS_UNAVAILABLE_ON_PREVIEW).toContain('clerk-js')
    expect(CLIENT_JS_UNAVAILABLE_ON_PREVIEW).toContain('production')
  })
})
