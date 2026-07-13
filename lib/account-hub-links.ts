/**
 * Account hub link rows — the pure source of truth for `/account`'s LINKS grid.
 *
 * Kept in its own zero-import file (no `next/*`, no `@clerk/nextjs/server`) so
 * the api spec (`e2e/account-hub-links.spec.ts`) can import it directly without
 * pulling in the page's `currentUser()`/`redirect()` auth guard — same idiom as
 * `lib/account-menu.ts` (the desktop `CuentaMenu` dropdown's own, separate list)
 * and `lib/tabbar-visibility.ts`.
 *
 * Mobile Clerk account management — added the `/account/settings` row (the only
 * discoverable entry point to Clerk's `<UserProfile />` on mobile, where the
 * desktop `CuentaMenu` is hidden).
 */

export type AccountHubLink = {
  href: string
  icon: string
  label: string
  desc: string
}

export const ACCOUNT_HUB_LINKS: readonly AccountHubLink[] = [
  { href: '/account/settings',      icon: 'iconoir-settings',     label: 'Administrar cuenta', desc: 'Correo, contraseña y seguridad' },
  { href: '/account/orders',        icon: 'iconoir-shopping-bag', label: 'Mis compras',    desc: 'Pedidos y seguimiento de envíos' },
  { href: '/account/favorites',     icon: 'iconoir-heart',        label: 'Favoritos',      desc: 'Anuncios que guardaste' },
  { href: '/account/subscriptions', icon: 'iconoir-credit-card',  label: 'Suscripciones',  desc: 'Tus suscripciones activas' },
  { href: '/account/print-ads',     icon: 'iconoir-journal',      label: 'Anuncios impresos', desc: 'Tus anuncios en la edición impresa' },
  { href: '/account/referrals',     icon: 'iconoir-gift',         label: 'Invita y gana',  desc: 'Comparte tu enlace y gana crédito' },
  { href: '/account/notificaciones', icon: 'iconoir-bell',        label: 'Notificaciones', desc: 'Elige qué te avisamos y por dónde' },
  { href: '/comunidad/nuevo',       icon: 'iconoir-megaphone',    label: 'Comparte con tu colonia', desc: 'Aparece en la sección social impresa' },
  { href: '/messages',              icon: 'iconoir-chat-bubble',  label: 'Mensajes',       desc: 'Conversaciones con vendedores' },
  { href: '/shop/manage',           icon: 'iconoir-shop',         label: 'Mi tienda',      desc: 'Vende y gestiona tus anuncios' },
] as const
