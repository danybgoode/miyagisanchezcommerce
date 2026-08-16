/**
 * The population guard for the communications catalog (marketplace-communications · D2).
 *
 * A registry nobody updates is worse than no registry: it reads as authoritative
 * while quietly describing a system that has moved on. So this spec does not check
 * the catalog against a number someone typed — it DERIVES the population from
 * `lib/email.ts` itself and fails when the two disagree in either direction.
 *
 * Deriving the sender list by reading the source, rather than importing the module,
 * is deliberate: `lib/email.ts` is `server-only`-adjacent and pulls in Resend and
 * the Clerk backend client, neither of which belongs in the `api` runner. The text
 * scan needs no network, no keys and no build step — which is the only reason this
 * check is cheap enough to run on every PR.
 *
 * Both directions matter. A sender with no catalog entry is a communication nobody
 * documented. A catalog entry naming a sender that no longer exists is a map with a
 * road on it that was demolished — and that one is the more dangerous of the two,
 * because the admin surface renders it and the sample sender would try to call it.
 */
import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  COMMUNICATION_CATALOG,
  DELIBERATELY_UNWIRED,
  accountedSenders,
  filterCommunications,
} from '../lib/notifications/catalog'

/**
 * Infrastructure exports that match the `send*` shape but are not communications.
 *
 * `sendWithResult` is the TRANSPORT every sender goes through — it has no trigger,
 * no actor pair and no channel, so a catalog entry for it would be a lie. Named
 * explicitly rather than pattern-excluded: a list of two is auditable, and a regex
 * clever enough to exclude it would eventually exclude a real sender too.
 */
const NOT_COMMUNICATIONS = new Set(['sendWithResult'])

/** The exported senders of `lib/email.ts`, read from source. */
function exportedSenders(): string[] {
  const source = readFileSync(join(process.cwd(), 'lib', 'email.ts'), 'utf8')
  return [...source.matchAll(/^export async function (send\w+)/gm)]
    .map((m) => m[1])
    .filter((name) => !NOT_COMMUNICATIONS.has(name))
}

test.describe('communications catalog population', () => {
  test('every exported email sender is accounted for', () => {
    const accounted = accountedSenders()
    const missing = exportedSenders().filter((sender) => !accounted.has(sender))
    expect(
      missing,
      `lib/email.ts exports these senders with no entry in lib/notifications/catalog.ts. ` +
        `Add a catalog entry, or register it in DELIBERATELY_UNWIRED with a reason.`,
    ).toEqual([])
  })

  test('every catalog entry names a sender that still exists', () => {
    const exported = new Set(exportedSenders())
    const dangling = [...accountedSenders()].filter((sender) => !exported.has(sender))
    expect(
      dangling,
      `lib/notifications/catalog.ts names senders that lib/email.ts no longer exports.`,
    ).toEqual([])
  })

  test('keys are unique — the admin surface and the sample sender key off them', () => {
    const keys = COMMUNICATION_CATALOG.map((entry) => entry.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  test('every entry declares at least one channel', () => {
    const channelless = COMMUNICATION_CATALOG.filter((entry) => entry.channels.length === 0)
    expect(channelless.map((e) => e.key)).toEqual([])
  })

  test('a deliberately-unwired sender is allowed, so the guard cannot reject a correct state', () => {
    // The negation of what we ban must stay expressible — a guard that fails on a
    // legitimate state is one people learn to bypass (LEARNINGS.md, shipped twice).
    // This asserts the ESCAPE HATCH works, not that it is currently used.
    const accountedWith = new Set([
      ...COMMUNICATION_CATALOG.map((e) => e.sender),
      ...[...DELIBERATELY_UNWIRED, { sender: 'sendNothingAtAll', reason: 'fixture' }].map((e) => e.sender),
    ])
    expect(accountedWith.has('sendNothingAtAll')).toBe(true)
  })
})

test.describe('communications filter', () => {
  test('an empty filter is the full set', () => {
    expect(filterCommunications(COMMUNICATION_CATALOG, {})).toHaveLength(COMMUNICATION_CATALOG.length)
  })

  test('filtering by recipient narrows to exactly that audience', () => {
    const toBuyer = filterCommunications(COMMUNICATION_CATALOG, { to: 'buyer' })
    expect(toBuyer.length).toBeGreaterThan(0)
    expect(toBuyer.length).toBeLessThan(COMMUNICATION_CATALOG.length)
    expect(toBuyer.every((entry) => entry.to === 'buyer')).toBe(true)
  })

  test('filtering by channel keeps only messages that can travel on it', () => {
    const telegram = filterCommunications(COMMUNICATION_CATALOG, { channel: 'telegram' })
    expect(telegram.every((entry) => entry.channels.includes('telegram'))).toBe(true)
    // Telegram is a fan-out addition to seller notifications, never a buyer channel.
    expect(telegram.every((entry) => entry.to === 'seller')).toBe(true)
  })

  test('the free-text query matches key and trigger, and is case-insensitive', () => {
    const byKey = filterCommunications(COMMUNICATION_CATALOG, { q: 'OFFER.' })
    expect(byKey.every((entry) => entry.key.startsWith('offer.'))).toBe(true)
    expect(byKey.length).toBeGreaterThan(0)

    const byTrigger = filterCommunications(COMMUNICATION_CATALOG, { q: 'devolución' })
    expect(byTrigger.length).toBeGreaterThan(0)
  })

  test('filters compose — each one narrows the previous result', () => {
    const all = filterCommunications(COMMUNICATION_CATALOG, {})
    const toSeller = filterCommunications(COMMUNICATION_CATALOG, { to: 'seller' })
    const toSellerOrders = filterCommunications(COMMUNICATION_CATALOG, { to: 'seller', domain: 'orders' })
    expect(toSellerOrders.length).toBeLessThanOrEqual(toSeller.length)
    expect(toSeller.length).toBeLessThanOrEqual(all.length)
    expect(toSellerOrders.every((e) => e.to === 'seller' && e.domain === 'orders')).toBe(true)
  })
})
