import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { marketCodeForCurrency, resolveMarketPresentation } from '../lib/market-presentation'
import {
  EVENT_GROUPS,
  EVENT_GROUP,
  GROUP_COPY,
  BUYER_EVENT_GROUPS,
  BUYER_EVENT_GROUP,
  BUYER_GROUP_COPY,
  CHANNEL_DEFAULTS,
} from '../lib/notifications/preferences'

/**
 * The order-comms-chain audit (2026-08-15), regression-guarded.
 *
 * Every assertion here corresponds to a defect that was LIVE in production and that
 * no test, monitor or review round caught — because each one failed silently. The
 * common shape: a discarded `error`, a bare `catch {}`, a `.catch(() => {})`, a
 * `return null` on a best-effort path. Nothing crashed and every HTTP status was 200.
 *
 * The structural assertions read source text on purpose. The functions they guard
 * live in `server-only` modules that cannot be imported into this project (same
 * idiom as `portfolio-reminders.spec.ts`), and in every case the defect was the
 * SHAPE of the call, not the value it returned — which is exactly what a unit test
 * over a fake cannot see. `a-pure-planner-needs-the-real-call-shape`, again.
 */

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8')

/**
 * Source with comment lines removed.
 *
 * A "you must not call X" guard has to read CODE, not prose — the fix for this very
 * bug left a comment quoting the removed `fetch(…/finalize-manual)` so the next
 * person knows why it must not come back, and the first version of the guard below
 * failed on that comment. A guard that rejects a correct file trains people to
 * delete the guard (LEARNINGS: "a guard that rejects correct output is worse than
 * one that misses a rare fault").
 */
const codeOf = (rel: string) =>
  read(rel)
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'))
    })
    .join('\n')

// ── ⑤ the column that never existed ──────────────────────────────────────────

test.describe('messages pages · marketplace_shops.market_code', () => {
  test('NEITHER page selects a market_code off the Supabase mirror', () => {
    // `market_code` is a fact of the Medusa seller. The mirror has never had the
    // column, so PostgREST answered 400 — the list page discarded the error and
    // rendered an empty inbox, the detail page turned it into a 404. Four days,
    // every user, both pages, no alert.
    // /account/favorites is the THIRD page with this exact defect — found by
    // scripts/audit-select-columns.mjs, not by grepping, which is the whole argument
    // for the mechanical scan: guard the population, not the door you found.
    for (const page of [
      'app/(shell)/messages/page.tsx',
      'app/(shell)/messages/[id]/page.tsx',
      'app/(shell)/account/favorites/page.tsx',
    ]) {
      const source = read(page)
      const select = source.slice(source.indexOf('.select('), source.indexOf('.eq('))
      expect(select).not.toContain('market_code')
    }
  })

  test('the mechanical scan exists and REFUSES to pass without credentials', () => {
    // A schema check that exits 0 having read no schema reads as a passing gate.
    const script = read('scripts/audit-select-columns.mjs')
    expect(script).toContain('Refusing to report a green result without checking anything')
    expect(script).toContain('refusing to pass')
  })

  test('BOTH pages capture the query error instead of discarding it', () => {
    // `const { data } = await db…` was the bug. An unread `error` is how a failed
    // read becomes indistinguishable from an empty result.
    for (const page of ['app/(shell)/messages/page.tsx', 'app/(shell)/messages/[id]/page.tsx']) {
      expect(read(page)).toMatch(/error:\s*conv/)
    }
  })

  test('the detail page does NOT answer a failed read with notFound()', () => {
    // 404 tells the user the conversation is gone. That was false and unactionable:
    // the conversation existed and had just been created for them.
    const source = read('app/(shell)/messages/[id]/page.tsx')
    const errorBranch = source.slice(source.indexOf('if (convError)'), source.indexOf('if (!conv)'))
    expect(errorBranch).toContain('throw new Error')
    expect(errorBranch).not.toContain('notFound()')
    // …and still 404s a conversation that genuinely is not there.
    expect(source).toContain('if (!conv) notFound()')
  })
})

// ── the presentation source that replaced it ─────────────────────────────────

test.describe('marketCodeForCurrency', () => {
  test('maps each market currency to its own market, either case', () => {
    expect(marketCodeForCurrency('MXN')).toBe('mx')
    expect(marketCodeForCurrency('mxn')).toBe('mx')
    expect(marketCodeForCurrency('USD')).toBe('us')
    expect(marketCodeForCurrency(' usd ')).toBe('us')
  })

  test('an unknown or absent currency is NULL, never a silent slide into Mexico', () => {
    // The caller applies its own default explicitly. Burying `?? 'mx'` in here is how
    // a US listing would quietly render as pesos.
    for (const bad of ['EUR', '', '   ', null, undefined, 42, {}]) {
      expect(marketCodeForCurrency(bad)).toBeNull()
    }
  })

  test('is derived from the registry, so a new market cannot be missed', () => {
    // Not a literal currency table — that is the second copy that drifts.
    expect(read('lib/market-presentation.ts')).toContain('Object.values(MARKETS)')
  })

  test('feeds a real presentation end to end', () => {
    expect(resolveMarketPresentation(marketCodeForCurrency('USD') ?? 'mx').currency).toBe('USD')
    expect(resolveMarketPresentation(marketCodeForCurrency('MXN') ?? 'mx').currency).toBe('MXN')
  })
})

// ── ① the authenticated HTTP call to ourselves ───────────────────────────────

test.describe('manual-order emails', () => {
  test('lib/cart.ts does NOT fetch its own finalize-manual route', () => {
    // THE regression. `fetch(`${SITE_URL}/api/orders/finalize-manual`)` was correct
    // while startCheckout ran in the browser; PR 244 moved it server-side, where the
    // request carries no Clerk cookie, and it 401'd on every manual order for 32
    // days behind a `.catch(() => {})`.
    const code = codeOf('lib/cart.ts')
    expect(code).not.toMatch(/fetch\([^)]*finalize-manual/)
    expect(code).toContain("import('./orders/manual-order-emails')")
  })

  test('the miss is LOGGED rather than swallowed', () => {
    const source = read('lib/cart.ts')
    expect(source).toContain('manual order emails NOT sent')
  })

  test('a missing JWT is reported as a reason, not as success', () => {
    const source = read('lib/orders/manual-order-emails.ts')
    expect(source).toContain("reason: 'no_auth'")
    // The old route returned a bare 401 and the caller ignored it. The library now
    // says out loud that a real order went unannounced.
    expect(source).toContain('NO confirmation email sent for')
  })

  test('an order with no seller Clerk id is named, not skipped in silence', () => {
    expect(read('lib/orders/manual-order-emails.ts')).toContain('seller NOT notified')
  })

  test('buyerClerkUserId is SERVER-derived — a body cannot address a push', () => {
    // It selects who receives a notification, so accepting it from the request would
    // let any caller notify any user. `/api/checkout/start` overwrites, not defaults.
    const source = read('app/api/checkout/start/route.ts')
    expect(source).toContain('const { userId } = await auth()')
    expect(source).toMatch(/\.\.\.body,\s*buyerClerkUserId: userId/)
  })
})

// ── ⑥ conversations that notified nobody ─────────────────────────────────────

test.describe('conversation notifications', () => {
  test('"mensajes" is a real preference group on BOTH sides', () => {
    expect(EVENT_GROUPS).toContain('mensajes')
    expect(BUYER_EVENT_GROUPS).toContain('buyer.mensajes')
    expect(EVENT_GROUP.conversation_message).toBe('mensajes')
    expect(BUYER_EVENT_GROUP.conversation_message).toBe('buyer.mensajes')
  })

  test('it has settings copy, so it is togglable rather than invisible', () => {
    for (const copy of [GROUP_COPY.mensajes, BUYER_GROUP_COPY['buyer.mensajes']]) {
      expect(copy.label.length).toBeGreaterThan(0)
      expect(copy.summary.length).toBeGreaterThan(10)
    }
  })

  test('email is on by default for it — push alone was the whole bug', () => {
    // The seller in the audited order had zero push subscriptions and no Telegram
    // link, so a push-only notification reached them through no channel at all.
    expect(CHANNEL_DEFAULTS.email).toBe(true)
  })

  test('starting a conversation now notifies the seller', () => {
    // It previously wrote `seller_unread = 1` and told nobody — the unread badge was
    // the entire mechanism, on a page that was itself broken.
    // The exact statement, not just the identifier: a presence check passes against
    // `void 0 && notifyConversationMessage(…)`, which notifies nobody.
    expect(codeOf('app/api/conversations/start/route.ts'))
      .toMatch(/void notifyConversationMessage\(\{/)
  })

  test('a reply goes through the preference seam, NOT raw web push', () => {
    const code = codeOf('app/api/conversations/[id]/stamp/route.ts')
    expect(code).toContain('notifyConversationMessage')
    expect(code).not.toMatch(/await notify\(/)
  })

  test('nobody-to-notify is recorded, because it means a lost question', () => {
    expect(read('lib/notifications/conversation.ts')).toContain('no recipient for conversation')
  })
})

// ── ④ the ledger ─────────────────────────────────────────────────────────────

test.describe('notification_log', () => {
  test('all three TRANSPORTS write to it — not the ~65 senders', () => {
    // At the transport, a new sender is covered for free and none can forget.
    for (const transport of ['lib/email.ts', 'lib/notify.ts', 'lib/telegram.ts']) {
      expect(read(transport)).toContain('logNotification')
    }
  })

  test('every non-send outcome carries a reason', () => {
    // "We never tried" and "we tried and it bounced" are different facts. An absent
    // row cannot tell them apart, which is the ambiguity this table exists to remove.
    for (const [file, reasons] of [
      ['lib/email.ts', ["'unconfigured'", "'too_soon'", "'rejected'"]],
      ['lib/notify.ts', ["'unconfigured'", "'no_subscription'", "'all_endpoints_rejected'"]],
      ['lib/telegram.ts', ["'unconfigured'", "'no_recipient'", "'network'"]],
    ] as Array<[string, string[]]>) {
      const source = read(file)
      for (const reason of reasons) expect(source).toContain(reason)
    }
  })

  test('the ledger can never break a send', () => {
    const source = read('lib/notifications/log.ts')
    expect(source).toContain('void (async () => {')
    expect(source).toContain('catch')
  })

  test('the migration records skips and failures, not only sends', () => {
    const sql = read('supabase/migrations/20260815045409_notification_log.sql')
    expect(sql).toContain("check (outcome in ('sent', 'skipped', 'failed'))")
    expect(sql).toContain('enable row level security')
  })
})
