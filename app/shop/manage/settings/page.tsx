import { redirect } from 'next/navigation'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import Link from 'next/link'

export const metadata = { title: 'Configuración — Miyagi Sánchez' }

// ── Section definitions ────────────────────────────────────────────────────────

const SECTIONS = [
  {
    key: 'perfil',
    icon: 'iconoir-shop',
    title: 'Perfil de tienda',
    desc: 'Nombre, descripción, ubicación, logo y banner.',
    color: 'var(--accent)',
    bg: 'var(--accent-soft)',
  },
  {
    key: 'pagos',
    icon: 'iconoir-credit-card',
    title: 'Métodos de pago',
    desc: 'Stripe Connect, Mercado Pago y transferencia SPEI.',
    color: '#009EE3',
    bg: '#e8f7fd',
  },
  {
    key: 'envios',
    icon: 'iconoir-delivery-truck',
    title: 'Envíos y entrega',
    desc: 'Mercado Envíos, recolección local y puntos de pickup.',
    color: 'var(--warning)',
    bg: 'var(--warning-soft)',
  },
  {
    key: 'negociacion',
    icon: 'iconoir-message-text',
    title: 'Negociación y ofertas',
    desc: 'Nivel de confianza mínimo y negociación automática A2A.',
    color: 'var(--info)',
    bg: 'var(--info-soft)',
  },
  {
    key: 'citas',
    icon: 'iconoir-calendar',
    title: 'Citas y agendas',
    desc: 'Integración con Cal.com para agendar visitas y pruebas.',
    color: 'var(--fg)',
    bg: 'var(--bg-sunk)',
  },
  {
    key: 'notificaciones',
    icon: 'iconoir-bell',
    title: 'Notificaciones',
    desc: 'Qué correos recibes y cuándo.',
    color: 'var(--warning)',
    bg: 'var(--warning-soft)',
  },
  {
    key: 'diseno',
    icon: 'iconoir-colour-filter',
    title: 'Diseño y marca',
    desc: 'Color de acento, redes sociales y tagline.',
    color: 'var(--energy)',
    bg: 'var(--energy-soft)',
  },
  {
    key: 'agentes',
    icon: 'iconoir-sparks',
    title: 'Agentes e integraciones',
    desc: 'Webhook UCP, prompts para agentes y API de comercio.',
    color: 'var(--agent)',
    bg: 'var(--agent-soft)',
  },
  {
    key: 'canal',
    icon: 'iconoir-internet',
    title: 'Canal propio',
    desc: 'Dominio personalizado y configuración de tienda federada.',
    color: 'var(--accent)',
    bg: 'var(--accent-soft)',
  },
  {
    key: 'pedidos',
    icon: 'iconoir-box',
    title: 'Gestión de pedidos',
    desc: 'Tiempos de procesamiento, confirmación y ventanas de despacho.',
    color: 'var(--fg)',
    bg: 'var(--bg-sunk)',
  },
  {
    key: 'politicas',
    icon: 'iconoir-undo',
    title: 'Devoluciones',
    desc: 'Define tu política de devoluciones. Se muestra en cada anuncio.',
    color: 'var(--fg)',
    bg: 'var(--bg-sunk)',
  },
] as const

// ── Completion helpers (rough check per section) ──────────────────────────────

function completedSections(shop: {
  name: string; description: string | null; logo_url: string | null
  mp_enabled: boolean | null; stripe_ok: boolean; clabe_ok: boolean
  calcom_ok: boolean; custom_domain: string | null
  orders_ok: boolean; returns_ok: boolean
}): Set<string> {
  const done = new Set<string>()
  if (shop.name && shop.description) done.add('perfil')
  if (shop.stripe_ok || shop.mp_enabled || shop.clabe_ok) done.add('pagos')
  if (shop.calcom_ok) done.add('citas')
  if (shop.custom_domain) done.add('canal')
  if (shop.orders_ok) done.add('pedidos')
  if (shop.returns_ok) done.add('politicas')
  return done
}

export default async function SettingsIndexPage() {
  const user = await currentUser()
  if (!user) redirect('/sign-in')

  const { data: shop } = await db
    .from('marketplace_shops')
    .select('id, slug, name, description, logo_url, metadata, mp_enabled, custom_domain')
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

  const shopComputed = {
    name: shop.name,
    description: (shop as unknown as { description: string | null }).description,
    logo_url: (shop as unknown as { logo_url: string | null }).logo_url,
    mp_enabled: (shop as unknown as { mp_enabled: boolean | null }).mp_enabled,
    stripe_ok: !!stripeSettings?.charges_enabled,
    clabe_ok: !!checkoutSettings?.bank_transfer?.clabe,
    calcom_ok: !!calcomSettings?.connected,
    custom_domain: (shop as unknown as { custom_domain: string | null }).custom_domain,
    orders_ok: !!ordersSettings?.processing_time,
    returns_ok: !!(returnsPolicySettings?.window),
  }

  const done = completedSections(shopComputed)

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <Link href="/shop/manage" style={{ fontSize: 13, color: 'var(--fg-muted)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 12 }} className="hover:text-[var(--fg)]">
          <i className="iconoir-arrow-left" style={{ fontSize: 16 }} />
          Mi tienda
        </Link>
        <h1 style={{ fontWeight: 700, fontSize: 24 }}>Configuración</h1>
        <p style={{ fontSize: 14, color: 'var(--fg-muted)', marginTop: 4 }}>
          {done.size} de {SECTIONS.filter(s => !('soon' in s && s.soon)).length} secciones configuradas
        </p>
        {/* Progress bar */}
        <div style={{ height: 4, background: 'var(--border)', borderRadius: 4, marginTop: 10, overflow: 'hidden' }}>
          <div style={{ height: '100%', background: 'var(--accent)', borderRadius: 4, width: `${(done.size / SECTIONS.filter(s => !('soon' in s && s.soon)).length) * 100}%`, transition: 'width 600ms' }} />
        </div>
      </div>

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
                  ) : null}
                </div>
                <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2, lineHeight: 1.4 }}>{section.desc}</p>
              </div>
              <i className="iconoir-arrow-right" style={{ fontSize: 14, color: 'var(--fg-subtle)', alignSelf: 'center', flexShrink: 0 }} />
            </div>
          </Link>
          )
        })}
      </div>

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
