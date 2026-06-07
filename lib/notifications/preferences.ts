/**
 * Pure notification-preference model + resolver.
 *
 * No `server-only`, no `next/*` imports — so the Playwright runner (and any unit
 * test) can import this module directly. Per LEARNINGS: a unit-tested helper must
 * not pull in `next/cache`/`server-only`; keep the pure logic here and let the
 * server-only dispatcher (`dispatch.ts`) import *it*.
 *
 * Model: a seller's preferences form a grid of event-groups × channels. The store
 * is sparse — only explicit toggles are persisted. An absent row resolves to
 * **enabled** (`DEFAULT_PREFS`), so the 164 existing sellers (zero rows) keep
 * today's behaviour with no backfill.
 */

export const EVENT_GROUPS = ['orders', 'offers', 'payments', 'returns'] as const
export type EventGroup = (typeof EVENT_GROUPS)[number]

export const CHANNELS = ['email', 'push', 'telegram'] as const
export type Channel = (typeof CHANNELS)[number]

/**
 * Concrete seller-facing events → their preference group. Sprint 1 routes only
 * the two already-durable events; Sprint 3 extends this map (buyer_reported_paid,
 * payment_confirmed → payments; order_shipped/delivered → orders; etc.).
 */
export const EVENT_GROUP = {
  new_order: 'orders',
  offer_made: 'offers',
} as const satisfies Record<string, EventGroup>
export type SellerEventKind = keyof typeof EVENT_GROUP

/** Shape of a persisted `notification_preferences` record. */
export type PrefRow = { channel: string; event_group: string; enabled: boolean }

/** Resolved grid: group → channel → enabled. */
export type Prefs = Record<EventGroup, Record<Channel, boolean>>

/**
 * Per-channel default when a seller has no explicit row.
 *   email / push → ON (default-on = zero regression for the 164 existing sellers).
 *   telegram     → OFF (opt-in): Telegram couldn't deliver before Sprint 2, so a
 *                  freshly-linked seller doesn't get flooded — they turn on the
 *                  groups they want. There is no regression either way (net-new).
 */
export const CHANNEL_DEFAULTS: Record<Channel, boolean> = {
  email: true,
  push: true,
  telegram: false,
}

/** Build a fresh grid from the per-channel defaults. */
function defaultGrid(): Prefs {
  return EVENT_GROUPS.reduce((acc, g) => {
    acc[g] = CHANNELS.reduce((c, ch) => {
      c[ch] = CHANNEL_DEFAULTS[ch]
      return c
    }, {} as Record<Channel, boolean>)
    return acc
  }, {} as Prefs)
}

/** The default grid: email/push on, telegram opt-in (off). */
export const DEFAULT_PREFS: Prefs = defaultGrid()

function isEventGroup(v: string): v is EventGroup {
  return (EVENT_GROUPS as readonly string[]).includes(v)
}
function isChannel(v: string): v is Channel {
  return (CHANNELS as readonly string[]).includes(v)
}

/** Overlay persisted rows on the defaults. Unknown/invalid keys are ignored. */
export function resolvePrefs(rows: PrefRow[] | null | undefined): Prefs {
  const prefs = defaultGrid()
  for (const row of rows ?? []) {
    if (isEventGroup(row.event_group) && isChannel(row.channel)) {
      prefs[row.event_group][row.channel] = !!row.enabled
    }
  }
  return prefs
}

/**
 * Is `channel` enabled for `group` in these prefs? Falls back to the channel's
 * own default if the cell is unknown (email/push on, telegram off).
 */
export function isChannelEnabled(prefs: Prefs, group: EventGroup, channel: Channel): boolean {
  return prefs[group]?.[channel] ?? CHANNEL_DEFAULTS[channel]
}

/** A persisted Telegram link (or null when the seller hasn't connected one). */
export type TelegramLink = { chat_id: string } | null

/**
 * Resolve the Telegram target for an event: the seller's linked chat_id when the
 * group is enabled on Telegram AND a link exists; otherwise null (no send). Pure
 * so the dispatcher's linked/unlinked/group-off decision is unit-testable.
 */
export function telegramTarget(prefs: Prefs, group: EventGroup, link: TelegramLink): string | null {
  if (!link) return null
  return isChannelEnabled(prefs, group, 'telegram') ? link.chat_id : null
}

/** Resolve the preference group for a concrete event kind. */
export function groupForEvent(kind: SellerEventKind): EventGroup {
  return EVENT_GROUP[kind]
}
