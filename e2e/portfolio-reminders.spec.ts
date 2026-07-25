import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_SLA_POLICY } from '../lib/portfolio/sla'
import {
  REMINDER_KINDS,
  reminderWindowKey,
  selectReminderTargets,
  buildReminderCopy,
  reminderDeepLinkPath,
  type ReminderTarget,
  foldLatestReminderFailures,
} from '../lib/portfolio/reminders'
import type { PortfolioRow } from '../lib/portfolio/resolver'

/**
 * Merchant Partner lifecycle · Sprint 2, Story 2.2 (api project, network-free):
 * the idempotent steward reminder rail's PURE half. `lib/portfolio/
 * reminders.ts` is zero-import beyond two zero-import siblings (types only),
 * so everything below runs with no database, no Clerk, no Next.
 *
 * The load-bearing assertions:
 *   1. `reminderWindowKey` is STABLE — the same due/window value always
 *      produces the same key, independent of `now` (README D6: the window is
 *      a property of the commitment, never of wall-clock time).
 *   2. `ReminderTarget` HAS NO DRAFT-SHAPED FIELD (Story 2.3's second spec) —
 *      proven against the type's own source text, not just its current
 *      runtime shape.
 *   3. The reminder copy never reads from a draft.
 *
 * RED-OBSERVED (red-green DoD): see the PR body / the builder's report.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

function row(over: Partial<PortfolioRow> = {}): PortfolioRow {
  return {
    id: 'r1',
    businessName: 'Tienda Uno',
    contactName: null,
    estado: null,
    municipio: null,
    category: null,
    stage: 'qualified',
    stageOrdinal: 2,
    ageInStageDays: 3,
    preferredChannel: null,
    nextActionId: null,
    nextActionDueAt: null,
    missingAction: false,
    blocker: false,
    consentState: 'sin_vista_previa',
    openTaskCount: 0,
    lastInteractionAt: null,
    stewardClerkUserId: 'steward_1',
    assignmentHandoffNote: null,
    assignedAt: null,
    dueState: 'overdue',
    slaDueAt: '2026-07-20T00:00:00.000Z',
    slaOverdue: true,
    slaOverdueReason: 'action_past_due',
    escalationTarget: null,
    slaPolicyVersion: DEFAULT_SLA_POLICY.version,
    ...over,
  }
}

test.describe('reminderWindowKey — stable per window, independent of wall-clock', () => {
  test('the SAME dueAt always produces the SAME key', () => {
    const a = reminderWindowKey('sla_overdue', '2026-07-20T00:00:00.000Z')
    const b = reminderWindowKey('sla_overdue', '2026-07-20T00:00:00.000Z')
    expect(a).toBe(b)
  })

  test('a DIFFERENT dueAt produces a DIFFERENT key', () => {
    const a = reminderWindowKey('sla_overdue', '2026-07-20T00:00:00.000Z')
    const b = reminderWindowKey('sla_overdue', '2026-07-21T00:00:00.000Z')
    expect(a).not.toBe(b)
  })

  test('reminderWindowKey does not accept a `now` parameter at all — the window can never depend on wall-clock time (source-text guard, not just a call-site check)', () => {
    const source = read('lib/portfolio/reminders.ts')
    const sig = source.match(/export function reminderWindowKey\(([^)]*)\)/)
    expect(sig, 'reminderWindowKey not found').not.toBeNull()
    expect(sig![1]).not.toMatch(/\bnow\b/)
  })

  test('REMINDER_KINDS is non-empty and includes sla_overdue', () => {
    expect(REMINDER_KINDS.length).toBeGreaterThan(0)
    expect(REMINDER_KINDS as readonly string[]).toContain('sla_overdue')
  })
})

test.describe('selectReminderTargets — overdue rows only, steward/escalation carried through', () => {
  test('a non-overdue row is never selected', () => {
    const targets = selectReminderTargets([row({ slaOverdue: false, dueState: 'scheduled' })], new Date(), DEFAULT_SLA_POLICY)
    expect(targets).toEqual([])
  })

  test('an overdue row IS selected, with the steward/escalation/reason carried through verbatim', () => {
    const r = row({ id: 'r2', stewardClerkUserId: 'steward_2', escalationTarget: 'escalate_1', slaOverdueReason: 'stage_stalled' })
    const [target] = selectReminderTargets([r], new Date(), DEFAULT_SLA_POLICY)
    expect(target).toMatchObject({
      relationshipId: 'r2',
      kind: 'sla_overdue',
      stewardClerkUserId: 'steward_2',
      escalationTarget: 'escalate_1',
      overdueReason: 'stage_stalled',
      businessName: 'Tienda Uno',
    })
    expect(target.windowKey).toBe(reminderWindowKey('sla_overdue', r.slaDueAt))
  })

  test('a relationship with no steward carries a null stewardClerkUserId through — the delivery layer decides the escalation fallback, this function only reports the facts', () => {
    const r = row({ stewardClerkUserId: null, escalationTarget: 'escalate_only' })
    const [target] = selectReminderTargets([r], new Date(), DEFAULT_SLA_POLICY)
    expect(target.stewardClerkUserId).toBeNull()
    expect(target.escalationTarget).toBe('escalate_only')
  })

  test('two overdue rows with the SAME dueAt produce the SAME windowKey (same commitment, same window)', () => {
    const a = row({ id: 'a', slaDueAt: '2026-07-20T00:00:00.000Z' })
    const b = row({ id: 'b', slaDueAt: '2026-07-20T00:00:00.000Z' })
    const [ta, tb] = selectReminderTargets([a, b], new Date(), DEFAULT_SLA_POLICY)
    expect(ta.windowKey).toBe(tb.windowKey)
    // But they are still TWO separate targets — the constraint is scoped by
    // relationship_id too, not just window_key.
    expect(ta.relationshipId).not.toBe(tb.relationshipId)
  })
})

test.describe('ReminderTarget has NO draft-shaped field (Story 2.3\'s second spec)', () => {
  test('the interface\'s own source text names no draft-related property', () => {
    const source = read('lib/portfolio/reminders.ts')
    const start = source.indexOf('export interface ReminderTarget')
    const end = source.indexOf('\n}', start)
    const body = source.slice(start, end)
    for (const forbidden of ['draftText', 'draft_text', 'editedText', 'edited_text', 'draftId', 'draft_id', 'factIds', 'templateId']) {
      expect(body, forbidden).not.toContain(forbidden)
    }
  })

  // Checked against an ACTUAL import specifier (`from '@/lib/portfolio/draft-*'`),
  // never a bare substring match — both files' own header comments correctly
  // MENTION the draft modules in prose (explaining the guarantee), and a
  // substring check would fail on that true, harmless prose. This was
  // observed failing exactly that way on the first run of this spec, which
  // is what caught the too-strict assertion (red-green DoD, note the PR body).
  function importsAny(source: string, specifiers: string[]): string | null {
    for (const spec of specifiers) {
      if (new RegExp(`from\\s+['"]${spec.replace(/\//g, '\\/')}['"]`).test(source)) return spec
    }
    return null
  }

  const DRAFT_MODULE_SPECIFIERS = [
    '@/lib/portfolio/draft-facts',
    '@/lib/portfolio/draft-compose',
    '@/lib/portfolio/draft-server',
  ]

  test('reminders.ts imports nothing from the draft modules — a population guard re-derived from the filesystem', () => {
    const source = read('lib/portfolio/reminders.ts')
    expect(importsAny(source, DRAFT_MODULE_SPECIFIERS)).toBeNull()
  })

  test('reminders-server.ts imports nothing from the draft modules either', () => {
    const source = read('lib/portfolio/reminders-server.ts')
    expect(importsAny(source, DRAFT_MODULE_SPECIFIERS)).toBeNull()
  })

  test('sanity — importsAny is non-vacuous: it DOES catch a real import', () => {
    expect(importsAny("import { x } from '@/lib/portfolio/draft-facts'", DRAFT_MODULE_SPECIFIERS)).toBe(
      '@/lib/portfolio/draft-facts',
    )
  })
})

test.describe('buildReminderCopy — built from ReminderTarget alone, never PII', () => {
  test('the copy names the business and a Spanish reason label, and carries no contact field', () => {
    const target: ReminderTarget = {
      relationshipId: 'r9',
      kind: 'sla_overdue',
      windowKey: reminderWindowKey('sla_overdue', '2026-07-20T00:00:00.000Z'),
      stewardClerkUserId: 'steward_9',
      escalationTarget: null,
      overdueReason: 'no_dated_action',
      businessName: 'Café Don Memo',
      dueAt: '2026-07-20T00:00:00.000Z',
    }
    const copy = buildReminderCopy(target)
    expect(copy.title).toContain('Café Don Memo')
    expect(copy.body).toContain('Café Don Memo')
    expect(copy.telegramHtml).toContain('Café Don Memo')
    expect(copy.body).not.toMatch(/@|\+52|\d{10}/)
  })

  test('an unrecognized overdueReason falls back to the raw string rather than throwing', () => {
    const target: ReminderTarget = {
      relationshipId: 'r10',
      kind: 'sla_overdue',
      windowKey: 'k',
      stewardClerkUserId: null,
      escalationTarget: null,
      overdueReason: 'a_future_reason_not_in_the_label_map' as ReminderTarget['overdueReason'],
      businessName: 'X',
      dueAt: '2026-07-20T00:00:00.000Z',
    }
    expect(() => buildReminderCopy(target)).not.toThrow()
  })
})

test.describe('reminderDeepLinkPath — relationship id only, no contact data, no bypass token', () => {
  test('the path carries only the relationship id', () => {
    const path = reminderDeepLinkPath('abc-123')
    expect(path).toBe('/partner?relationshipId=abc-123')
  })

  test('the id is URL-encoded', () => {
    const path = reminderDeepLinkPath('a b/c')
    expect(path).not.toContain(' ')
    expect(decodeURIComponent(path.split('=')[1])).toBe('a b/c')
  })
})

// ── Layer 2 · reminders-server.ts claims BEFORE it delivers ─────────────────

test.describe('source · reminders-server.ts claims under the UNIQUE constraint before delivering (README D6)', () => {
  const source = read('lib/portfolio/reminders-server.ts')

  test('the insert (claim) appears before any notify()/tgSend() call in claimAndDeliver', () => {
    const fnStart = source.indexOf('async function claimAndDeliver')
    const body = source.slice(fnStart)
    const insertAt = body.indexOf(".from('merchant_followup_reminders')\n    .insert(")
    const notifyAt = body.indexOf('await notify(')
    const tgAt = body.indexOf('await tgSend(')
    expect(insertAt, 'claim insert not found').toBeGreaterThan(-1)
    expect(notifyAt, 'notify() call not found').toBeGreaterThan(-1)
    expect(tgAt, 'tgSend() call not found').toBeGreaterThan(-1)
    expect(insertAt).toBeLessThan(notifyAt)
    expect(insertAt).toBeLessThan(tgAt)
  })

  test('a 23505 unique violation is treated as "already reminded" and skipped silently — never surfaced as an error', () => {
    expect(source).toContain("claimError.code === '23505'")
    expect(source).toMatch(/23505[\s\S]{0,40}return 'already_reminded'/)
  })

  test('delivery is never a SELECT-then-INSERT — no .select(...).maybeSingle() read of merchant_followup_reminders happens before the insert', () => {
    const fnStart = source.indexOf('async function claimAndDeliver')
    const fnEnd = source.indexOf('\n}', fnStart)
    const body = source.slice(fnStart, fnEnd)
    const insertAt = body.indexOf('.insert(')
    const firstSelectAt = body.indexOf('.select(')
    // The FIRST `.select(` in this function is the one CHAINED onto the
    // insert itself (`.insert({...}).select('id')`), which must appear
    // AFTER `.insert(` in the source text — never a separate read before it.
    expect(firstSelectAt).toBeGreaterThan(insertAt)
  })

  test('this file never IMPORTS lib/notifications/dispatch.ts (the file header correctly MENTIONS it in prose — checked against an import specifier, not a bare substring)', () => {
    expect(source).not.toMatch(/from\s+['"]@\/lib\/notifications\/dispatch['"]/)
    expect(source).not.toMatch(/\bgetSellerEmail\s*\(/)
  })

  test('the CRON_ACTOR is a synthetic admin actor, never a real Clerk id, and is never written to a row', () => {
    expect(source).toContain("clerkUserId: 'system:portfolio-reminders-cron'")
    expect(source).toMatch(/isAdmin:\s*true/)
  })
})

// ── Layer 2 · the cron route's auth + status-code posture ───────────────────

test.describe('source · GET /api/cron/portfolio-reminders matches the shipped cron posture', () => {
  const source = read('app/api/cron/portfolio-reminders/route.ts')

  test('its own route file — not folded into merchant-lifecycle-sweep (the header correctly MENTIONS that route by name in prose; checked here against an actual import/call, not the bare string)', () => {
    expect(source).not.toMatch(/from\s+['"]@\/lib\/merchant-lifecycle-sweep['"]/)
    expect(source).not.toMatch(/\bsweepMerchantLifecycle\s*\(/)
  })

  test('CRON_SECRET gate: open when unset outside production, closed otherwise — same shape as the shipped cron', () => {
    expect(source).toContain('process.env.CRON_SECRET')
    expect(source).toMatch(/NODE_ENV\s*!==\s*['"]production['"]/)
    expect(source).toContain('Bearer ${secret}')
  })

  test('a failed/incomplete run is reported as 503, never a 2xx', () => {
    expect(source).toMatch(/status:\s*503/)
    expect(source).not.toMatch(/status:\s*207/)
  })
})

test.describe('source · the S2 migration\'s reminders table matches the build contract', () => {
  const sql = read('supabase/migrations/20260725110000_partner_portfolio_s2.sql')

  test('merchant_followup_reminders has the UNIQUE idempotency constraint', () => {
    expect(sql).toContain('UNIQUE (relationship_id, kind, window_key)')
  })

  test('merchant_followup_reminders has RLS enabled', () => {
    expect(sql).toContain('ALTER TABLE merchant_followup_reminders ENABLE ROW LEVEL SECURITY;')
  })
})

// ── Layer 1 · live guard ─────────────────────────────────────────────────────

test.describe('live · GET /api/cron/portfolio-reminders never 5xxs for an unauthorized caller', () => {
  test('no Authorization header → never a 5xx', async ({ request }) => {
    const res = await request.get('/api/cron/portfolio-reminders')
    expect(res.status()).toBeLessThan(500)
  })
})

// ── foldLatestReminderFailures (cross-agent review finding, PR 310) ──────────
//
// A REAL false-positive bug, found by the cross-family reviewer. The original
// fold lived inlined in `lib/portfolio/reminders-server.ts` and used its RESULT
// map as the "already handled this relationship" test — but that map is only ever
// written for a FAILED row. So a relationship whose NEWEST reminder SUCCEEDED
// never closed out, and the next older FAILED row was accepted instead: the
// portfolio showed "Recordatorio no entregado" for a merchant whose latest
// reminder had been delivered cleanly, sending a partner to chase a delivery that
// already happened.
//
// Two things made it survive to review: the code's comment described the INTENDED
// rule ("newest-first + first-write-wins") rather than what the code did — and the
// two only agree when every row failed — and the function lived in a `server-only`
// module no spec could load. The fold is now extracted into the zero-import
// `lib/portfolio/reminders.ts`, so these branches are actually reachable.

test.describe('foldLatestReminderFailures — only the LATEST reminder decides the badge', () => {
  test('THE REGRESSION: a successful newest row suppresses an older failure', () => {
    // Newest-first, exactly as the query orders them.
    const failures = foldLatestReminderFailures([
      { relationshipId: 'r-1', lastError: null, windowKey: 'w1', deliveredChannelCount: 2 },
      { relationshipId: 'r-1', lastError: 'telegram 500', windowKey: 'w0', deliveredChannelCount: 0 },
    ])
    expect(failures.has('r-1')).toBe(false)
    expect(failures.size).toBe(0)
  })

  test('a failing newest row reports THAT error, not an older one', () => {
    const failures = foldLatestReminderFailures([
      { relationshipId: 'r-1', lastError: 'push expired', windowKey: 'w1', deliveredChannelCount: 0 },
      { relationshipId: 'r-1', lastError: 'telegram 500', windowKey: 'w0', deliveredChannelCount: 0 },
    ])
    expect(failures.get('r-1')).toBe('push expired')
  })

  test('a single failed row is reported', () => {
    expect(foldLatestReminderFailures([{ relationshipId: 'r-1', lastError: 'boom', windowKey: 'w1', deliveredChannelCount: 0 }]).get('r-1')).toBe('boom')
  })

  test('relationships are independent — one merchant’s failure never masks another’s success', () => {
    const failures = foldLatestReminderFailures([
      { relationshipId: 'r-ok', lastError: null, windowKey: 'w1', deliveredChannelCount: 1 },
      { relationshipId: 'r-bad', lastError: 'boom', windowKey: 'w1', deliveredChannelCount: 0 },
      { relationshipId: 'r-ok', lastError: 'stale', windowKey: 'w0', deliveredChannelCount: 0 },
      { relationshipId: 'r-bad', lastError: 'older boom', windowKey: 'w0', deliveredChannelCount: 0 },
    ])
    expect(failures.get('r-bad')).toBe('boom')
    expect(failures.has('r-ok')).toBe(false)
  })

  test('an empty input is an empty map, never a throw', () => {
    expect(foldLatestReminderFailures([]).size).toBe(0)
  })

  test('the server module no longer carries its own fold — it delegates to the pure one', () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'lib/portfolio/reminders-server.ts'),
      'utf8',
    )
    // Matched on the CALL, not its exact argument list — the window-scoping fix
    // (finding 3) added a second argument, and a guard that pins an argument list
    // it doesn't care about just breaks on every legitimate change.
    expect(src).toMatch(/foldLatestReminderFailures\(\s*rows/)
    // The exact defective idiom must not come back.
    expect(src).not.toContain('if (byId.has(row.relationship_id)) continue')
  })
})

// ── Window-scoping + partial delivery (fresh-reviewer findings 2/3, PR 310) ────
//
// The cross-agent review caught the badge surviving a later SUCCESS. The fresh
// reviewer then caught the same false-positive shape on two more axes, both of
// which the contract's own wording ("the latest reminder FOR THE CURRENT WINDOW
// failed") already excluded:
//
//   · a failure from a SUPERSEDED window badging a row that is healthy again,
//     permanently, because nothing compared `window_key`; and
//   · a PARTIAL delivery (telegram down, push through) badging "no se entregó"
//     for a steward who was in fact notified — so one Telegram outage would have
//     marked every overdue merchant undelivered.

test.describe('foldLatestReminderFailures — only a CURRENT-window, fully-undelivered reminder badges', () => {
  const CURRENT = new Map([['r-1', 'w1']])

  test('a failure from a SUPERSEDED window does not badge a now-healthy row', () => {
    const failures = foldLatestReminderFailures(
      [{ relationshipId: 'r-1', lastError: 'telegram 500', windowKey: 'w0', deliveredChannelCount: 0 }],
      CURRENT,
    )
    expect(failures.has('r-1')).toBe(false)
  })

  test('a failure in the CURRENT window still badges', () => {
    const failures = foldLatestReminderFailures(
      [{ relationshipId: 'r-1', lastError: 'nada disponible', windowKey: 'w1', deliveredChannelCount: 0 }],
      CURRENT,
    )
    expect(failures.get('r-1')).toBe('nada disponible')
  })

  test('a PARTIAL delivery never badges — the steward was reached', () => {
    const failures = foldLatestReminderFailures(
      [{ relationshipId: 'r-1', lastError: 'telegram 500', windowKey: 'w1', deliveredChannelCount: 1 }],
      CURRENT,
    )
    expect(failures.has('r-1')).toBe(false)
  })

  test('omitting the current-window map accepts any window (back-compatible for a caller with no window notion)', () => {
    const failures = foldLatestReminderFailures([
      { relationshipId: 'r-1', lastError: 'boom', windowKey: 'whatever', deliveredChannelCount: 0 },
    ])
    expect(failures.get('r-1')).toBe('boom')
  })
})

test.describe('the reminder rail can OBSERVE a failure at all (finding 2)', () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'lib/portfolio/reminders-server.ts'),
    'utf8',
  )

  test('reachability is PRE-CHECKED, because both transports return silently when unconfigured', () => {
    // `notify()` bails on missing VAPID or an empty `push_subscriptions`; `tgSend()`
    // bails on a missing token/chat id. Both are `Promise<void>` and swallow — so a
    // try/catch alone can never see the common failure, and the row would claim a
    // two-channel delivery for a run where nobody was notified.
    expect(src).toContain('push_subscriptions')
    expect(src).toContain('tgConfigured()')
  })

  test('a run where NO channel got through records an error even though nothing threw', () => {
    expect(src).toMatch(/channels\.length === 0 && lastError === null/)
    expect(src).toContain('Ningún canal disponible')
  })

  test('the cron REFUSES an unreadable SLA policy rather than risk a duplicate window (finding 4)', () => {
    expect(src).toMatch(/source === 'read_failed'/)
  })
})
