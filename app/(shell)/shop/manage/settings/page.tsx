import { redirect } from 'next/navigation'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import Link from 'next/link'
import { SellerBreadcrumb } from '../SellerBreadcrumb'
import { orderedSections, MANUAL_KEYS } from '@/lib/shop-settings/taxonomy'
import { isEnabled } from '@/lib/flags'

export const metadata = { title: 'Configuración — Miyagi Sánchez' }

// ── Section definitions ────────────────────────────────────────────────────────
// Sourced from the one canonical taxonomy (lib/shop-settings/taxonomy.ts).
// Adapted to the card-render shape this grid already uses (key/title), so the
// JSX below is unchanged. `cardTitle` is the index-card label (only "Devoluciones"
// differs from the focused-page heading). MANUAL_KEYS — sections needing a live
// handshake (OAuth / money / domain / webhook) — also comes from the map.

const SECTIONS = orderedSections().map((s) => ({
  key: s.slug,
  icon: s.icon,
  title: s.cardTitle,
  desc: s.desc,
  color: s.color,
  bg: s.bg,
}))

// ── Completion helpers (rough check per section) ──────────────────────────────

function completedSections(shop: {
  name: string; description: string | null
  mp_enabled: boolean | null; stripe_ok: boolean; clabe_ok: boolean
  calcom_ok: boolean; custom_domain: string | null
  orders_ok: boolean; returns_ok: boolean
  envios_ok: boolean; negociacion_ok: boolean; notificaciones_ok: boolean
  diseno_ok: boolean; agentes_ok: boolean; paginas_ok: boolean
}): Set<string> {
  const done = new Set<string>()
  if (shop.name && shop.description) done.add('perfil')
  if (shop.stripe_ok || shop.mp_enabled || shop.clabe_ok) done.add('pagos')
  if (shop.calcom_ok) done.add('citas')
  if (shop.custom_domain) done.add('canal')
  if (shop.orders_ok) done.add('pedidos')
  if (shop.returns_ok) done.add('politicas')
  if (shop.envios_ok) done.add('envios')
  if (shop.negociacion_ok) done.add('negociacion')
  if (shop.notificaciones_ok) done.add('notificaciones')
  if (shop.diseno_ok) done.add('diseno')
  if (shop.agentes_ok) done.add('agentes')
  if (shop.paginas_ok) done.add('paginas')
  return done
}

export default async function SettingsIndexPage() {
  const user = await currentUser()
  if (!user) redirect('/sign-in')

  const { data: shop } = await db
    .from('marketplace_shops')
    .select('id, slug, name, description, logo_url, metadata, mp_enabled, custom_domain, ucp_webhook_url')
    .eq('clerk_user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!shop) redirect('/sell')

  const meta = shop.metadata as Record<string, unknown> | null
  const settings = (meta?.settings ?? {}) as Record<string, unknown>
  const stripeSettings = settings.stripe as { charges_enabled?: boolean } | undefined
  const calcomSettings = settings.calcom as { connected?: boolean } | undefined
  const checkoutSettings = settings.checkout as { bank_transfer?: { clabe?: string } } | undefined
  const ordersSettings = settings.orders as { processing_time?: string } | undefined
  const returnsPolicySettings = settings.returns_policy as { window?: string } | undefined
  const themeSettings = settings.theme as { banner_url?: string | null; accent_color?: string | null; tagline?: string | null; social?: Record<string, string | null> } | undefined
  const shippingSettings = settings.shipping as { local_pickup?: boolean; envia_enabled?: boolean; pickup_spots?: unknown[]; origin_address?: Record<string, string | null> } | undefined
  const offersSettings = settings.offers as { min_buyer_trust_level?: string; negotiation?: { enabled?: boolean } } | undefined
  const notifSettings = settings.notifications as { email_new_view?: boolean; email_new_message?: boolean } | undefined
  const aboutSettings = settings.about as { body?: string } | null | undefined
  const faqSettings = settings.faq as { items?: unknown[] } | null | undefined

  // The native settings editor persists the whole settings tree on every save,
  // so an empty shell (e.g. default accent color, all-null origin address) is
  // NOT "configured". Use value-based checks so a section lights up only when it
  // holds real data — whether typed in by hand or applied by the importer.
  const hasSocial = !!themeSettings?.social && Object.values(themeSettings.social).some(Boolean)
  const diseno_ok = !!(themeSettings && (themeSettings.banner_url || themeSettings.tagline || hasSocial || (themeSettings.accent_color && themeSettings.accent_color !== '#1d6f42')))
  const hasOrigin = !!shippingSettings?.origin_address && Object.values(shippingSettings.origin_address).some(Boolean)
  const envios_ok = !!(shippingSettings && (shippingSettings.local_pickup || shippingSettings.envia_enabled || hasOrigin || (Array.isArray(shippingSettings.pickup_spots) && shippingSettings.pickup_spots.length > 0)))
  const negociacion_ok = !!(offersSettings && ((offersSettings.min_buyer_trust_level && offersSettings.min_buyer_trust_level !== 'unverified') || offersSettings.negotiation?.enabled))
  const notificaciones_ok = !!(notifSettings && (notifSettings.email_new_view || notifSettings.email_new_message))

  const shopComputed = {
    name: shop.name,
    description: (shop as unknown as { description: string | null }).description,
    mp_enabled: (shop as unknown as { mp_enabled: boolean | null }).mp_enabled,
    stripe_ok: !!stripeSettings?.charges_enabled,
    clabe_ok: !!checkoutSettings?.bank_transfer?.clabe,
    calcom_ok: !!calcomSettings?.connected,
    custom_domain: (shop as unknown as { custom_domain: string | null }).custom_domain,
    orders_ok:  !!ordersSettings?.processing_time,
    // 'none' = explicitly configured but not a positive trust signal → still mark done
    // '' / undefined = not yet configured → not done
    returns_ok: !!(returnsPolicySettings?.window),
    envios_ok,
    negociacion_ok,
    notificaciones_ok,
    diseno_ok,
    agentes_ok: !!(shop as unknown as { ucp_webhook_url: string | null }).ucp_webhook_url,
    paginas_ok: !!(aboutSettings?.body || (faqSettings?.items?.length ?? 0) > 0),
  }

  const done = completedSections(shopComputed)

  // Mercado Libre connect is dark-shipped behind a flag (epic 03 · mercadolibre-sync).
  // The entry card appears only once `ml.connect_enabled` is flipped on.
  const mlEnabled = await isEnabled('ml.connect_enabled')

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <SellerBreadcrumb className="mb-3" />
        <h1 style={{ fontWeight: 700, fontSize: 24 }}>Configuración</h1>
        <p style={{ fontSize: 14, color: 'var(--fg-muted)', marginTop: 4 }}>
          {done.size} de {SECTIONS.filter(s => !('soon' in s && s.soon)).length} secciones configuradas
        </p>
        {/* Progress bar */}
        <div style={{ height: 4, background: 'var(--border)', borderRadius: 4, marginTop: 10, overflow: 'hidden' }}>
          <div style={{ height: '100%', background: 'var(--accent)', borderRadius: 4, width: `${(done.size / SECTIONS.filter(s => !('soon' in s && s.soon)).length) * 100}%`, transition: 'width 600ms' }} />
        </div>
      </div>

      {/* Import config CTA */}
      <Link href="/shop/manage/settings/import" className="no-underline">
        <div style={{ marginBottom: 16, padding: '14px 16px', background: 'var(--accent-soft)', border: '1px solid var(--accent)', borderRadius: 'var(--r-lg)', display: 'flex', alignItems: 'center', gap: 12 }} className="hover:shadow-[var(--shadow-2)]">
          <i className="iconoir-import" style={{ fontSize: 20, color: 'var(--accent)', flexShrink: 0 }} />
          <div className="flex-1 min-w-0">
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--accent)' }}>¿Te cambias de plataforma? Importa tu configuración</p>
            <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2, lineHeight: 1.4 }}>Sube un archivo y configura tu tienda de un jalón, sin pasar por cada pantalla.</p>
          </div>
          <i className="iconoir-arrow-right" style={{ fontSize: 14, color: 'var(--fg-subtle)', flexShrink: 0 }} />
        </div>
      </Link>

      {/* Section grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(1, 1fr)', gap: 10 }} className="sm:grid-cols-2">
        {SECTIONS.map(section => {
          const isSoon = 'soon' in section && section.soon
          return (
          <Link
            key={section.key}
            href={`/shop/manage/settings/${section.key}`}
            className="no-underline"
            style={{ opacity: isSoon ? 0.65 : 1 }}
          >
            <div
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 14,
                padding: '16px', background: 'var(--bg-elevated)',
                border: '1.5px solid var(--border)',
                borderRadius: 'var(--r-lg)',
                boxShadow: 'var(--shadow-1)',
                transition: 'box-shadow 150ms',
                position: 'relative',
                overflow: 'hidden',
              }}
              className={isSoon ? '' : 'hover:shadow-[var(--shadow-2)]'}
            >
              <div style={{ width: 40, height: 40, borderRadius: 'var(--r-md)', background: section.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <i className={section.icon} style={{ fontSize: 20, color: section.color }} />
              </div>
              <div className="flex-1 min-w-0">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <p style={{ fontWeight: 600, fontSize: 14, color: 'var(--fg)' }}>{section.title}</p>
                  {isSoon ? (
                    <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--warning)', background: 'var(--warning-soft)', border: '1px solid var(--warning)', borderRadius: 'var(--r-pill)', padding: '2px 7px', flexShrink: 0 }}>Próximamente</span>
                  ) : done.has(section.key) ? (
                    <span style={{ fontSize: 11, color: 'var(--success)', fontWeight: 600, flexShrink: 0 }}>✓</span>
                  ) : MANUAL_KEYS.has(section.key) ? (
                    <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--fg-muted)', background: 'var(--bg-sunk)', border: '1px solid var(--border)', borderRadius: 'var(--r-pill)', padding: '2px 7px', flexShrink: 0 }}>Pendiente</span>
                  ) : null}
                </div>
                <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2, lineHeight: 1.4 }}>{section.desc}</p>
                {!isSoon && !done.has(section.key) && MANUAL_KEYS.has(section.key) && (
                  <p style={{ fontSize: 11, color: 'var(--warning)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4, lineHeight: 1.3 }}>
                    <i className="iconoir-warning-triangle" style={{ fontSize: 12, flexShrink: 0 }} />
                    Aún requiere un paso manual — termínalo aquí.
                  </p>
                )}
              </div>
              <i className="iconoir-arrow-right" style={{ fontSize: 14, color: 'var(--fg-subtle)', alignSelf: 'center', flexShrink: 0 }} />
            </div>
          </Link>
          )
        })}
      </div>

      {/* Mercado Libre (dark-shipped behind ml.connect_enabled) */}
      {mlEnabled && (
        <Link href="/shop/manage/mercadolibre" className="no-underline">
          <div style={{ marginTop: 16, padding: '16px', background: 'var(--bg-elevated)', border: '1.5px solid var(--border)', borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow-1)', display: 'flex', alignItems: 'flex-start', gap: 14 }} className="hover:shadow-[var(--shadow-2)]">
            <div style={{ width: 40, height: 40, borderRadius: 'var(--r-md)', background: 'var(--warning-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <i className="iconoir-shop-four-tiles" style={{ fontSize: 20, color: 'var(--warning)' }} />
            </div>
            <div className="flex-1 min-w-0">
              <p style={{ fontWeight: 600, fontSize: 14, color: 'var(--fg)' }}>Mercado Libre</p>
              <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2, lineHeight: 1.4 }}>Conecta tu cuenta para sincronizar tu catálogo e inventario.</p>
            </div>
            <i className="iconoir-arrow-right" style={{ fontSize: 14, color: 'var(--fg-subtle)', alignSelf: 'center', flexShrink: 0 }} />
          </div>
        </Link>
      )}

      {/* Agent CTA */}
      <div style={{ marginTop: 24, padding: '14px 16px', background: 'var(--agent-soft)', borderRadius: 'var(--r-lg)', border: '1px solid var(--agent)', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <i className="iconoir-sparks" style={{ fontSize: 20, color: 'var(--agent)', flexShrink: 0, marginTop: 1 }} />
        <div>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--agent)', marginBottom: 4 }}>Configura con tu agente</p>
          <p style={{ fontSize: 13, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
            Puedes pedirle a tu agente que configure tu tienda por ti. Comparte el enlace de tu tienda y deja que negocie mientras tú descansas.
          </p>
        </div>
      </div>
    </div>
  )
}
