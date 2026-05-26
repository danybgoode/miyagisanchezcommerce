import { redirect, notFound } from 'next/navigation'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import Link from 'next/link'
import ShopSettingsPanel from '../ShopSettings'
import type { Metadata } from 'next'

const SECTION_TITLES: Record<string, string> = {
  perfil:         'Perfil de tienda',
  pagos:          'Métodos de pago',
  envios:         'Envíos y entrega',
  negociacion:    'Negociación y ofertas',
  citas:          'Citas y agendas',
  notificaciones: 'Notificaciones',
  diseno:         'Diseño y marca',
  agentes:        'Agentes e integraciones',
  canal:          'Canal propio',
  pedidos:        'Gestión de pedidos',
  politicas:      'Política de devoluciones',
}

const VALID_SECTIONS = new Set(Object.keys(SECTION_TITLES))

export async function generateMetadata({ params }: { params: Promise<{ section: string }> }): Promise<Metadata> {
  const { section } = await params
  const title = SECTION_TITLES[section]
  return { title: title ? `${title} — Configuración` : 'Configuración' }
}

export default async function SettingsSectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ section: string }>
  searchParams: Promise<Record<string, string>>
}) {
  const [{ section }, sp] = await Promise.all([params, searchParams])
  if (!VALID_SECTIONS.has(section)) notFound()

  const stripeError = sp.stripe === 'error' ? (sp.reason ?? 'Error desconocido al conectar Stripe.') : null
  const user = await currentUser()
  if (!user) redirect('/sign-in')

  const { data: shop } = await db
    .from('marketplace_shops')
    .select('id, slug, name, description, location, logo_url, metadata, mp_enabled, ucp_webhook_url, ucp_webhook_secret, calcom_api_key, custom_domain, custom_domain_verified')
    .eq('clerk_user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!shop) redirect('/sell')

  const meta = shop.metadata as Record<string, unknown> | null
  const settings = (meta?.settings ?? {}) as Record<string, unknown>
  const stripeSettings = settings.stripe as { account_id?: string; charges_enabled?: boolean; onboarding_complete?: boolean } | undefined
  const calcomSettings = settings.calcom as { connected?: boolean; username?: string; event_type_title?: string; booking_url?: string } | undefined
  const shopRow = shop as unknown as { calcom_api_key: string | null }

  const sectionTitle = SECTION_TITLES[section]

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Back nav */}
      <div style={{ marginBottom: 20 }}>
        <Link
          href="/shop/manage/settings"
          style={{ fontSize: 13, color: 'var(--fg-muted)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
          className="hover:text-[var(--fg)]"
        >
          <i className="iconoir-arrow-left" style={{ fontSize: 16 }} />
          Configuración
        </Link>
        <h1 style={{ fontWeight: 700, fontSize: 22, marginTop: 8 }}>{sectionTitle}</h1>
      </div>

      {/* Render the focused section from ShopSettings */}
      <ShopSettingsPanel
        stripeError={stripeError}
        activeSection={section}
        initial={{
          name: shop.name,
          description: (shop as unknown as { description: string | null }).description ?? '',
          location: (shop as unknown as { location: string | null }).location,
          logo_url: (shop as unknown as { logo_url: string | null }).logo_url,
          mp_enabled: (shop as unknown as { mp_enabled: boolean | null }).mp_enabled ?? true,
          ucp_webhook_url: (shop as unknown as { ucp_webhook_url: string | null }).ucp_webhook_url ?? null,
          ucp_webhook_secret: (shop as unknown as { ucp_webhook_secret: string | null }).ucp_webhook_secret ?? null,
          calcom_connected: !!(shopRow.calcom_api_key && calcomSettings?.connected),
          calcom_username: calcomSettings?.username ?? null,
          calcom_event_type_title: calcomSettings?.event_type_title ?? null,
          calcom_booking_url: calcomSettings?.booking_url ?? null,
          stripe: stripeSettings,
          metadata: shop.metadata as NonNullable<typeof shop.metadata> | null,
          slug: (shop as unknown as { slug: string }).slug,
          custom_domain: (shop as unknown as { custom_domain: string | null }).custom_domain ?? null,
          custom_domain_verified: (shop as unknown as { custom_domain_verified: boolean }).custom_domain_verified ?? false,
        }}
      />
    </div>
  )
}
