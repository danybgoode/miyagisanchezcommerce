/**
 * New-shop ops notification — pure seam.
 *
 * The ops Telegram ping for a brand-new shop fires from two routes:
 *   • POST /api/sell/shop          (onboarding wizard, net-new create)
 *   • POST /api/claim/complete     (gem-claim handshake, ownership transfer)
 *
 * Both build the SAME message, and both must fire ONLY on a net-new creation —
 * never on the idempotent already-exists / already-claimed branch. This module
 * holds the pure, dependency-free message builder + the net-new contract so the
 * text and the "fires on net-new, not on re-POST" rule are unit-testable without
 * a network send (LEARNINGS: extract the seam, test the seam). `tg.newShop`
 * delegates to `newShopPingText`, so the wire format stays single-sourced.
 */

/** HTML-escape an interpolated value for a `parse_mode: 'HTML'` Telegram body. */
function esc(s: string | number): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * The exact ops-chat string for a newly created/claimed shop:
 *   🏪 Nueva tienda reclamada
 *   <name>[ · <location>]
 *   miyagisanchez.com/s/<slug>
 */
export function newShopPingText(name: string, location: string | null, slug: string): string {
  return `🏪 <b>Nueva tienda reclamada</b>\n<b>${esc(name)}</b>${location ? ` · ${esc(location)}` : ''}\nmiyagisanchez.com/s/${esc(slug)}`
}

/**
 * Whether the new-shop ping should fire. `created` is true only on the net-new
 * branch of a create/claim route; the idempotent (already-exists / already-claimed)
 * branches pass false (or simply never reach the ping) → no double-ping.
 */
export function shouldPingShopCreate(created: boolean): boolean {
  return created
}
