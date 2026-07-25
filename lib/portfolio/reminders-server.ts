/**
 * lib/portfolio/reminders-server.ts
 *
 * Merchant Partner lifecycle · Sprint 2, Story 2.2 — the IMPURE half of the
 * steward reminder rail. CLAIMS under the `merchant_followup_reminders`
 * UNIQUE `(relationship_id, kind, window_key)` constraint FIRST, then
 * delivers (README D6). A `23505` unique violation means "already reminded
 * this window" and is skipped silently — never an error. This ordering is
 * the point: claim-then-send can at worst under-notify once (a crash between
 * claim and send); send-then-claim can double-notify, which is the failure
 * this epic exists to make impossible for a MERCHANT and is still worth
 * avoiding for a steward.
 *
 * DELIVERY IS STEWARD-DIRECTED ONLY. `notify(stewardClerkUserId, …)`
 * (`lib/notify.ts`, web push) plus the admin Telegram channel
 * (`lib/telegram.ts`) — the SAME ops-visibility rail every other `tg.*`
 * admin alert in this codebase already uses. This file NEVER imports
 * `lib/notifications/dispatch.ts` — that seam resolves a SELLER's email via
 * `getSellerEmail`, i.e. the merchant, which is exactly the duplicate-contact
 * failure this story forbids. `e2e/portfolio-no-auto-send.spec.ts` proves
 * the absence transitively.
 *
 * NO DRAFT TEXT EVER FLOWS THROUGH THIS FILE. `buildReminderCopy`
 * (`lib/portfolio/reminders.ts`) is the only source of the notification's
 * words; nothing here imports `draft-facts.ts`, `draft-compose.ts` or reads
 * `merchant_followup_drafts`.
 *
 * Runtime: Node only (Supabase service-role client).
 */
import 'server-only'
import { db } from '@/lib/supabase'
import { notify } from '@/lib/notify'
import { tgSend } from '@/lib/telegram'
import type { RelationshipActor } from '@/lib/relationship-access'
import { loadPortfolio } from '@/lib/portfolio/loader'
import { loadSlaPolicy } from '@/lib/portfolio/policy-server'
import {
  buildReminderCopy,
  reminderDeepLinkPath,
  selectReminderTargets,
  type ReminderTarget,
} from '@/lib/portfolio/reminders'

/** A synthetic admin-scoped actor for the cron's OWN read — `isAdmin: true`
 *  makes `listScopedRelationships` (via `loadPortfolio`) return every
 *  relationship, exactly like the admin operating views already do. Not a
 *  real Clerk identity; never written as an actor on any row. */
const CRON_ACTOR: RelationshipActor = {
  clerkUserId: 'system:portfolio-reminders-cron',
  promoterId: null,
  promoterCode: null,
  isAdmin: true,
}

export type ReminderOutcome = 'sent' | 'already_reminded' | 'failed'

/**
 * CLAIM under the UNIQUE constraint, then DELIVER. Never a SELECT-then-INSERT
 * — the constraint is the only thing that decides "have we already reminded
 * for this window", so two concurrent cron invocations can race the insert
 * and only one will ever win.
 */
async function claimAndDeliver(target: ReminderTarget, now: Date): Promise<ReminderOutcome> {
  const { data: claimed, error: claimError } = await db
    .from('merchant_followup_reminders')
    .insert({
      relationship_id: target.relationshipId,
      kind: target.kind,
      window_key: target.windowKey,
      steward_clerk_user_id: target.stewardClerkUserId,
    })
    .select('id')
    .maybeSingle()

  if (claimError) {
    // Postgres unique_violation. "Already reminded this window" — skip
    // silently, no error (build contract, Story 2.2).
    if (claimError.code === '23505') return 'already_reminded'
    console.error('[portfolio/reminders] claim insert failed:', claimError.message)
    return 'failed'
  }
  if (!claimed) return 'failed'

  const copy = buildReminderCopy(target)
  const url = reminderDeepLinkPath(target.relationshipId)
  // A relationship with no steward routes to the escalation target; if
  // there is none either, no push happens and only the admin Telegram ping
  // fires (README D6). NEVER the merchant — nothing here ever reads a
  // contact field off the relationship.
  const pushTarget = target.stewardClerkUserId ?? target.escalationTarget ?? null

  const channels: string[] = []
  let lastError: string | null = null

  if (pushTarget) {
    try {
      await notify(pushTarget, {
        kind: 'portfolio_reminder',
        title: copy.title,
        body: copy.body,
        url,
        tag: `portfolio-reminder:${target.relationshipId}:${target.windowKey}`,
      })
      channels.push('push')
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      console.error('[portfolio/reminders] push delivery failed:', err)
    }
  }

  try {
    await tgSend(undefined, copy.telegramHtml)
    channels.push('telegram')
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err)
    console.error('[portfolio/reminders] telegram delivery failed:', err)
  }

  // Quiet/failure state is VISIBLE (build contract): the row always records
  // what actually happened, even when nothing could be delivered. The CLAIM
  // itself is never rolled back or retried on a delivery failure — the
  // window stays used, and the failure is surfaced through `last_error`
  // instead (a silently-dead reminder rail is the failure mode this exists
  // to prevent, not a rail that retries forever inside one window).
  const { error: updateError } = await db
    .from('merchant_followup_reminders')
    .update({ sent_at: now.toISOString(), channels, last_error: lastError })
    .eq('id', claimed.id)
  if (updateError) console.error('[portfolio/reminders] outcome write failed:', updateError.message)

  return channels.length > 0 ? 'sent' : 'failed'
}

export interface RunRemindersResult {
  /** False when the run could not even LOAD the candidate population, or
   *  when any individual claim/delivery failed — a partial run must never
   *  report success (same posture as `sweepMerchantLifecycle`). */
  ok: boolean
  candidates: number
  sent: number
  alreadyReminded: number
  failed: number
}

/**
 * Load the FULL cross-partner overdue population (admin-scoped read, reusing
 * `loadPortfolio` rather than re-deriving the SLA/scope logic — README D1/D2:
 * no second population, no second SLA rule), select which rows are due for a
 * reminder, and claim+deliver each. Never throws — one target's failure must
 * not abort the rest, mirroring `sweepMerchantLifecycle`'s own discipline.
 */
export async function runPortfolioReminders(now: Date = new Date()): Promise<RunRemindersResult> {
  const policy = (await loadSlaPolicy()).policy
  const portfolio = await loadPortfolio(CRON_ACTOR, { view: 'all' }, now, policy)
  if (!portfolio.ok) {
    console.error('[portfolio/reminders] could not load the portfolio — refusing to run:', portfolio.error)
    return { ok: false, candidates: 0, sent: 0, alreadyReminded: 0, failed: 0 }
  }

  const targets = selectReminderTargets(portfolio.portfolio.rows, now, policy)

  let sent = 0
  let alreadyReminded = 0
  let failed = 0
  for (const target of targets) {
    let outcome: ReminderOutcome
    try {
      outcome = await claimAndDeliver(target, now)
    } catch (err) {
      console.error('[portfolio/reminders] target failed unexpectedly:', err)
      outcome = 'failed'
    }
    if (outcome === 'sent') sent += 1
    else if (outcome === 'already_reminded') alreadyReminded += 1
    else failed += 1
  }

  return { ok: failed === 0, candidates: targets.length, sent, alreadyReminded, failed }
}

/**
 * The most recent reminder's `last_error` per relationship, for the
 * "recordatorio no entregado" visibility the build contract requires. One
 * batched read (`.in`), never N+1. Fails CLOSED to an EMPTY map on a read
 * error — a missing failure badge degrades to "nothing shown", which is
 * strictly safer here than the list/SLA reads' fail-closed-to-500 rule: this
 * is a secondary annotation on an already-successfully-loaded portfolio, not
 * the operational claim itself, so losing it must not take the whole queue
 * down with it.
 */
export async function loadReminderFailures(relationshipIds: string[]): Promise<Map<string, string>> {
  const byId = new Map<string, string>()
  if (relationshipIds.length === 0) return byId
  const { data, error } = await db
    .from('merchant_followup_reminders')
    .select('relationship_id, last_error, created_at')
    .in('relationship_id', relationshipIds)
    .order('created_at', { ascending: false })
  if (error) {
    console.error('[portfolio/reminders] reminder-failure read failed — badges will be omitted:', error.message)
    return byId
  }
  for (const row of (data ?? []) as Array<{ relationship_id: string; last_error: string | null; created_at: string }>) {
    // Newest-first ordering + first-write-wins gives "the LATEST reminder for
    // this relationship", matching `readLastInteractions`'s own discipline in
    // `lib/portfolio/loader.ts`.
    if (byId.has(row.relationship_id)) continue
    if (row.last_error) byId.set(row.relationship_id, row.last_error)
  }
  return byId
}
