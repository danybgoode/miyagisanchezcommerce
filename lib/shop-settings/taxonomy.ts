/**
 * The ONE canonical shop-settings section taxonomy.
 *
 * Both surfaces that name sections derive from `SECTIONS` below:
 *   1. `[section]/page.tsx` — slug → page heading + the valid-slug set.
 *   2. `settings/page.tsx` — the index grid cards + `MANUAL_KEYS`.
 *
 * (A third source, the monolith's `SLUG_TO_SECTION_IDS` slug→internal-id map, was
 * removed in Sprint 4 when `ShopSettings.tsx` was deleted — there are no internal
 * sub-sections left, only one component per slug.)
 *
 * Next-free + pure, so a Playwright `api` spec can assert completeness for free.
 */

export type SectionGroup = 'tienda' | 'pagos' | 'ventas' | 'canal' | 'integraciones'

export interface SectionDef {
  /** URL slug — /shop/manage/settings/[slug]. */
  slug: string
  /** Heading shown on the focused `[section]` route. */
  title: string
  /** Title shown on the settings index card (differs from `title` only for `politicas`). */
  cardTitle: string
  /** One-line description on the index card. */
  desc: string
  icon: string
  color: string
  bg: string
  group: SectionGroup
  /**
   * Needs a live handshake a config file can't grant (OAuth / money / domain /
   * webhook secret). The index surfaces a "still needs a manual step" hint and the
   * importer refuses to set these from a file (see MANUAL_SECTIONS in settings-import).
   */
  manual: boolean
}

/** Index/grid order is the array order. */
export const SECTIONS: SectionDef[] = [
  {
    slug: 'perfil',
    title: 'Perfil de tienda',
    cardTitle: 'Perfil de tienda',
    desc: 'Nombre, descripción, ubicación, logo y banner.',
    icon: 'iconoir-shop',
    color: 'var(--accent)',
    bg: 'var(--accent-soft)',
    group: 'tienda',
    manual: false,
  },
  {
    slug: 'pagos',
    title: 'Métodos de pago',
    cardTitle: 'Métodos de pago',
    desc: 'Stripe Connect, Mercado Pago y transferencia SPEI.',
    icon: 'iconoir-credit-card',
    color: 'var(--provider-mercadopago)',
    bg: 'var(--provider-mercadopago-soft)',
    group: 'pagos',
    manual: true,
  },
  {
    slug: 'envios',
    title: 'Envíos y entrega',
    cardTitle: 'Envíos y entrega',
    desc: 'Recolección local, dirección de origen y etiquetas con Envia.com.',
    icon: 'iconoir-delivery-truck',
    color: 'var(--warning)',
    bg: 'var(--warning-soft)',
    group: 'ventas',
    manual: false,
  },
  {
    slug: 'negociacion',
    title: 'Negociación y ofertas',
    cardTitle: 'Negociación y ofertas',
    desc: 'Nivel de confianza mínimo y negociación automática A2A.',
    icon: 'iconoir-message-text',
    color: 'var(--info)',
    bg: 'var(--info-soft)',
    group: 'ventas',
    manual: false,
  },
  {
    slug: 'citas',
    title: 'Citas y agendas',
    cardTitle: 'Citas y agendas',
    desc: 'Integración con Cal.com para agendar visitas y pruebas.',
    icon: 'iconoir-calendar',
    color: 'var(--fg)',
    bg: 'var(--bg-sunk)',
    group: 'ventas',
    manual: true,
  },
  {
    slug: 'notificaciones',
    title: 'Notificaciones',
    cardTitle: 'Notificaciones',
    desc: 'Qué correos recibes y cuándo.',
    icon: 'iconoir-bell',
    color: 'var(--warning)',
    bg: 'var(--warning-soft)',
    group: 'integraciones',
    manual: false,
  },
  {
    slug: 'diseno',
    title: 'Diseño y marca',
    cardTitle: 'Diseño y marca',
    desc: 'Color de acento, redes sociales y tagline.',
    icon: 'iconoir-colour-filter',
    color: 'var(--energy)',
    bg: 'var(--energy-soft)',
    group: 'tienda',
    manual: false,
  },
  {
    slug: 'agentes',
    title: 'Agentes e integraciones',
    cardTitle: 'Agentes e integraciones',
    desc: 'Webhook UCP, prompts para agentes y API de comercio.',
    icon: 'iconoir-sparks',
    color: 'var(--agent)',
    bg: 'var(--agent-soft)',
    group: 'integraciones',
    manual: true,
  },
  {
    slug: 'canal',
    title: 'Canal propio',
    cardTitle: 'Canal propio',
    desc: 'Dominio personalizado y configuración de tienda federada.',
    icon: 'iconoir-internet',
    color: 'var(--accent)',
    bg: 'var(--accent-soft)',
    group: 'canal',
    manual: true,
  },
  {
    slug: 'pedidos',
    title: 'Gestión de pedidos',
    cardTitle: 'Gestión de pedidos',
    desc: 'Tiempos de procesamiento, confirmación y ventanas de despacho.',
    icon: 'iconoir-box',
    color: 'var(--fg)',
    bg: 'var(--bg-sunk)',
    group: 'ventas',
    manual: false,
  },
  {
    slug: 'politicas',
    title: 'Política de devoluciones',
    cardTitle: 'Devoluciones',
    desc: 'Define tu política de devoluciones. Se muestra en cada anuncio.',
    icon: 'iconoir-undo',
    color: 'var(--fg)',
    bg: 'var(--bg-sunk)',
    group: 'ventas',
    manual: false,
  },
]

const BY_SLUG = new Map(SECTIONS.map((s) => [s.slug, s]))

/** All sections in index/grid order. */
export function orderedSections(): SectionDef[] {
  return SECTIONS
}

export function sectionDef(slug: string): SectionDef | undefined {
  return BY_SLUG.get(slug)
}

/** Page heading for the focused `[section]` route. */
export function sectionTitle(slug: string): string | undefined {
  return BY_SLUG.get(slug)?.title
}

export function isValidSection(slug: string): boolean {
  return BY_SLUG.has(slug)
}

export function isManual(slug: string): boolean {
  return BY_SLUG.get(slug)?.manual ?? false
}

/** Slugs that still need a manual step (was `MANUAL_KEYS` in the index page). */
export const MANUAL_KEYS = new Set(SECTIONS.filter((s) => s.manual).map((s) => s.slug))
