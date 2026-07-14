/**
 * Cuenta hub menu — the single, pure source of truth for the account dropdown.
 *
 * `CuentaMenu` (the client island) renders these; the api spec
 * (`e2e/account-menu.spec.ts`) loads them directly. Keeping the list here (no
 * DOM, no `next/*`) means the labels + hrefs can't drift between the component
 * and the test. Same idiom as `lib/tabbar-visibility.ts` ↔ its spec.
 *
 * Nav & Settings Reorg — Sprint 2 (Cuenta hub). es-MX labels.
 */

/** A link row → an existing route. */
export type AccountMenuLink = {
  kind: 'link'
  key: string
  label: string
  href: string
  icon: string
}

/** The theme row — not a route; renders the existing PlatformThemeToggle inline. */
export type AccountMenuTheme = {
  kind: 'theme'
  key: 'theme'
  label: string
  icon: string
}

export type AccountMenuItem = AccountMenuLink | AccountMenuTheme

/**
 * The Cuenta entries, in display order. Every link points at a route that
 * already exists (`/account`, `/account/*`, `/shop/manage`); "Tema" toggles the
 * platform theme in place. "Cambiar a modo vendedor" is the doorway to the
 * seller-mode shell (S3).
 *
 * "Mi cuenta" (→ bare `/account`, the hub) leads — this is the only reachable
 * entry point to `/account` on mobile web (the PWA-only bottom tab bar is the
 * sole other path, and only in the installed standalone PWA). "Agente IA"
 * was dropped: the agent is already reachable via the footer's `/agent` link
 * and the dedicated AI-agent affordance next to search, so this dropdown no
 * longer needs its own row for it (mobile-clerk-account-management fast-follow).
 */
export const ACCOUNT_MENU_ITEMS: readonly AccountMenuItem[] = [
  { kind: 'link',  key: 'account-home',  label: 'Mi cuenta',                href: '/account',                 icon: 'iconoir-user' },
  { kind: 'link',  key: 'favorites',     label: 'Favoritos',                href: '/account/favorites',      icon: 'iconoir-heart' },
  { kind: 'link',  key: 'orders',        label: 'Pedidos',                  href: '/account/orders',         icon: 'iconoir-shopping-bag' },
  { kind: 'link',  key: 'subscriptions', label: 'Suscripciones',            href: '/account/subscriptions',  icon: 'iconoir-credit-card' },
  { kind: 'link',  key: 'referrals',     label: 'Referidos',                href: '/account/referrals',      icon: 'iconoir-gift' },
  { kind: 'link',  key: 'notifications', label: 'Notificaciones',           href: '/account/notificaciones', icon: 'iconoir-bell' },
  { kind: 'theme', key: 'theme',         label: 'Tema',                                                      icon: 'iconoir-half-moon' },
  { kind: 'link',  key: 'seller-mode',   label: 'Cambiar a modo vendedor',  href: '/shop/manage',            icon: 'iconoir-shop' },
] as const
