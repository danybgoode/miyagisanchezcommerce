/**
 * The sample sender's guards (marketplace-communications · D5, D6, S3.1, S3.2).
 *
 * The assertion that matters is the refusal. This surface sends real mail from the
 * platform's real domain on demand — the allow-list is the only thing between a
 * Clerk-admin session and an arbitrary destination, so it is tested as a boundary,
 * not as a happy path.
 */
import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { COMMUNICATION_CATALOG } from '../lib/notifications/catalog'
import {
  SAMPLE_RECIPIENTS,
  decideSampleSend,
  isAllowedSampleRecipient,
} from '../lib/notifications/sample'

/**
 * Fixture keys read from source rather than imported: `fixtures.ts` imports
 * `lib/email.ts`, which is server-only and pulls in Resend and the Clerk backend
 * client — none of which belongs in the `api` runner. The text scan needs no
 * network and no keys, which is the only reason this check is cheap enough to run
 * on every PR.
 */
function fixtureKeys(): Set<string> {
  const source = readFileSync(join(process.cwd(), 'lib', 'notifications', 'fixtures.ts'), 'utf8')
  const body = source.slice(source.indexOf('COMMUNICATION_FIXTURES'))
  return new Set([...body.matchAll(/^\s{2}'([a-z0-9_.]+)':/gm)].map((m) => m[1]))
}

const catalogKeys = () => new Set(COMMUNICATION_CATALOG.map((entry) => entry.key))

test.describe('fixture coverage', () => {
  test('every catalog entry has a sample payload', () => {
    const fixtures = fixtureKeys()
    const missing = [...catalogKeys()].filter((key) => !fixtures.has(key))
    expect(
      missing,
      'these communications are listed in the admin but cannot be sent as a sample',
    ).toEqual([])
  })

  test('every fixture names a real catalog entry', () => {
    const keys = catalogKeys()
    const dangling = [...fixtureKeys()].filter((key) => !keys.has(key))
    expect(dangling, 'these fixtures reference a communication that no longer exists').toEqual([])
  })

  test('no fixture hardcodes a destination address', () => {
    // Every fixture must place the CALLER's address in the recipient field. A literal
    // address here would be a way to send somewhere unintended even with the
    // allow-list intact.
    const source = readFileSync(join(process.cwd(), 'lib', 'notifications', 'fixtures.ts'), 'utf8')
    const addresses = source.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? []
    expect(addresses, 'a fixture contains a literal email address').toEqual([])
  })
})

test.describe('the recipient allow-list', () => {
  test('accepts exactly the three named addresses', () => {
    for (const address of SAMPLE_RECIPIENTS) expect(isAllowedSampleRecipient(address)).toBe(true)
    expect(SAMPLE_RECIPIENTS).toHaveLength(3)
  })

  test('refuses anything else, including near-misses', () => {
    for (const address of [
      'attacker@example.com',
      'danielvp1987@gmail.com.evil.com',
      'DANIELVP1987@gmail.com',
      ' danielvp1987@gmail.com',
      'danielvp1987@gmail.com ',
      '',
      null,
      undefined,
      42,
    ]) {
      expect(isAllowedSampleRecipient(address), `${String(address)} must be refused`).toBe(false)
    }
  })
})

test.describe('decideSampleSend', () => {
  const known = () => catalogKeys()
  const fixtures = () => fixtureKeys()
  const anyKey = () => [...catalogKeys()][0]

  test('accepts a known key going to an allowed address', () => {
    const decision = decideSampleSend({ key: anyKey(), to: SAMPLE_RECIPIENTS[0] }, known(), fixtures())
    expect(decision.ok).toBe(true)
  })

  test('REFUSES a caller-supplied address rather than coercing it', () => {
    const decision = decideSampleSend({ key: anyKey(), to: 'attacker@example.com' }, known(), fixtures())
    expect(decision.ok).toBe(false)
    if (decision.ok) return
    expect(decision.reason).toBe('recipient_not_allowed')
    expect(decision.status).toBe(400)
  })

  test('checks the recipient BEFORE the fixture, so probing leaks no template names', () => {
    // A caller sending an unknown key with a bad address must learn about the
    // address, not about which templates do or do not have fixtures.
    const decision = decideSampleSend({ key: anyKey(), to: 'attacker@example.com' }, known(), new Set())
    expect(decision.ok).toBe(false)
    if (decision.ok) return
    expect(decision.reason).toBe('recipient_not_allowed')
  })

  test('refuses an unknown communication with 404', () => {
    const decision = decideSampleSend({ key: 'not.a.real.key', to: SAMPLE_RECIPIENTS[0] }, known(), fixtures())
    expect(decision.ok).toBe(false)
    if (decision.ok) return
    expect(decision.status).toBe(404)
  })

  test('refuses a missing key', () => {
    for (const body of [{}, { to: SAMPLE_RECIPIENTS[0] }, { key: '', to: SAMPLE_RECIPIENTS[0] }, null]) {
      expect(decideSampleSend(body, known(), fixtures()).ok).toBe(false)
    }
  })

  test('refuses a known key that has no fixture, naming that as the reason', () => {
    const decision = decideSampleSend({ key: anyKey(), to: SAMPLE_RECIPIENTS[0] }, known(), new Set())
    expect(decision.ok).toBe(false)
    if (decision.ok) return
    expect(decision.reason).toBe('no_fixture')
  })
})

test.describe('sample marking', () => {
  test('the transport prefixes the subject and adds a banner', () => {
    // Read the source: the marking lives inside `sendWithResult`, which cannot be
    // exercised here without Resend. What matters is that it happens at the single
    // transport rather than in each sender, so a new sender inherits it for free.
    const source = readFileSync(join(process.cwd(), 'lib', 'email.ts'), 'utf8')
    expect(source).toContain("const SAMPLE_SUBJECT_PREFIX = '[PRUEBA] '")
    expect(source).toContain('function sampleBanner(')
    expect(source).toContain('const sample = sampleContext.getStore()')
    // AsyncLocalStorage, not a module-level flag — two concurrent requests must not
    // be able to mark each other's mail.
    expect(source).toContain('new AsyncLocalStorage')
  })
})
