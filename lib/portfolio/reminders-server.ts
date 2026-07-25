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
import { tgSend, tgConfigured } from '@/lib/telegram'
import type { RelationshipActor } from '@/lib/relationship-access'
import { loadPortfolio } from '@/lib/portfolio/loader'
import { loadSlaPolicy } from '@/lib/portfolio/policy-server'
import {
  buildReminderCopy,
  foldLatestReminderFailures,
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
  const notAttempted: string[] = []
  let lastError: string | null = null

  // "Quiet/failure state is visible" REQUIRES knowing whether delivery was even
  // POSSIBLE — fresh-reviewer finding 2, PR 310. Both transports are
  // fire-and-forget `Promise<void>` that return SILENTLY when unconfigured:
  // `notify()` bails on missing VAPID or `!subs?.length`, and `tgSend()` bails on
  // a missing bot token/chat id. So the original `try/catch`-only accounting could
  // never observe a failure: `channels` always ended up `['push','telegram']`,
  // `last_error` always null, the row claimed a two-channel delivery, the badge
  // never rendered, and the cron reported 200 — for a run where NOBODY was
  // notified. And because the claim is never rolled back and `window_key` derives
  // from an unchanged `slaDueAt`, that commitment could never be reminded again.
  // That is verbatim the failure mode this column exists to prevent.
  //
  // Fixed by PRE-CHECKING reachability rather than by changing the shared
  // transports' contracts (13 admin call sites rely on `tgSend` never throwing).
  // A channel that could not even be ATTEMPTED is recorded as such — distinct
  // from one that was attempted and threw.
  if (pushTarget) {
    const { data: subs, error: subsError } = await db
      .from('push_subscriptions')
      .select('id')
      .eq('clerk_user_id', pushTarget)
      .limit(1)
    if (subsError) {
      notAttempted.push('push (no se pudo verificar la suscripción)')
    } else if (!subs || subs.length === 0) {
      notAttempted.push('push (el destinatario no tiene dispositivo registrado)')
    } else {
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
  } else {
    notAttempted.push('push (sin dueño ni destino de escalación)')
  }

  if (!tgConfigured()) {
    notAttempted.push('telegram (canal no configurado)')
  } else {
    try {
      await tgSend(undefined, copy.telegramHtml)
      channels.push('telegram')
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      console.error('[portfolio/reminders] telegram delivery failed:', err)
    }
  }

  // NOTHING got through ⇒ this is a FAILURE, and it must say so even when no
  // exception was thrown, because the common case throws nothing at all.
  if (channels.length === 0 && lastError === null) {
    lastError = `Ningún canal disponible: ${notAttempted.join('; ')}`
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
  // REFUSE on an unreadable policy (fresh-reviewer finding 4, PR 310). For a row
  // overdue by `no_dated_action`, `dueAt = lastTouch + window.responseDays`, so a
  // DIFFERENT `responseDays` yields a DIFFERENT `window_key` — and a different
  // window key is a second claim and a second steward notification for the same
  // overdue condition, which is exactly the idempotency the story promises. A
  // `read_failed` load silently substitutes the code default, so running on it
  // would arm that duplicate the moment the admin PUT route is ever used.
  // `writeSlaPolicy` already refuses on `read_failed` for the same reason; the
  // cron adopts the same posture and the route answers 503 (retryable).
  const loadedPolicy = await loadSlaPolicy()
  if (loadedPolicy.source === 'read_failed') {
    console.error('[portfolio/reminders] SLA policy unreadable — refusing the run rather than risk a duplicate window')
    return { ok: false, candidates: 0, sent: 0, alreadyReminded: 0, failed: 0 }
  }
  const policy = loadedPolicy.policy
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
export async function loadReminderFailures(
  relationshipIds: string[],
  /** Each relationship's CURRENT window key, so a failure from a window the
   *  merchant has since moved past does not badge a now-healthy row
   *  (fresh-reviewer finding 3, PR 310). */
  currentWindowByRelationship?: ReadonlyMap<string, string>,
): Promise<Map<string, string>> {
  const byId = new Map<string, string>()
  if (relationshipIds.length === 0) return byId
  const { data, error } = await db
    .from('merchant_followup_reminders')
    .select('relationship_id, last_error, created_at, window_key, channels')
    .in('relationship_id', relationshipIds)
    .order('created_at', { ascending: false })
  if (error) {
    console.error('[portfolio/reminders] reminder-failure read failed — badges will be omitted:', error.message)
    return byId
  }
  // The FOLD itself lives in `lib/portfolio/reminders.ts#foldLatestReminderFailures`
  // — zero-import, so an `api` spec can walk every branch. Extracted there after
  // the cross-agent review on PR 310 found a real false-positive in the version
  // inlined here: it used the RESULT map as its "already handled" test, but that
  // map is only written for a FAILED row, so a relationship whose newest reminder
  // SUCCEEDED never closed out and an older FAILED row was accepted instead —
  // showing "Recordatorio no entregado" for a merchant whose latest reminder was
  // delivered. Unreachable by any spec while it lived in this `server-only`
  // module, which is exactly why it shipped. This function now owns only the query.
  const rows = (
    (data ?? []) as Array<{
      relationship_id: string
      last_error: string | null
      window_key: string
      channels: string[] | null
    }>
  ).map((row) => ({
    relationshipId: row.relationship_id,
    lastError: row.last_error,
    windowKey: row.window_key,
    deliveredChannelCount: (row.channels ?? []).length,
  }))
  for (const [id, message] of foldLatestReminderFailures(rows, currentWindowByRelationship)) {
    byId.set(id, message)
  }
  return byId
}
