import { redirect, notFound } from 'next/navigation'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { isValidSection, sectionTitle } from '@/lib/shop-settings/taxonomy'
import { resolveDomainEntitlement } from '@/lib/domain-entitlement-server'
import type { PagosInitial } from '../_sections/Pagos'
import type {
  ReturnsPolicySettings, SettingsTree, OffersSettings, OrdersSettings, NotificationsSettings,
} from '@/lib/shop-settings/types'
import type { Metadata } from 'next'

// Per-section registry. Every section now lives in its own component, code-split
// into its own chunk via next/dynamic (the 4,200-line monolith was deleted in
// Sprint 4). `isValidSection()` gates the route to exactly these slugs, so the
// switch in renderExtracted() is total — there is no fallback.
const Devoluciones    = dynamic(() => import('../_sections/Devoluciones'))
const Perfil          = dynamic(() => import('../_sections/Perfil'))
const Diseno          = dynamic(() => import('../_sections/Diseno'))
const Negociacion     = dynamic(() => import('../_sections/Negociacion'))
const Envios          = dynamic(() => import('../_sections/Envios'))
const Citas           = dynamic(() => import('../_sections/Citas'))
const Pedidos         = dynamic(() => import('../_sections/Pedidos'))
const Notificaciones  = dynamic(() => import('../_sections/Notificaciones'))
const Pagos           = dynamic(() => import('../_sections/Pagos'))
const Canal           = dynamic(() => import('../_sections/Canal'))
const Agentes         = dynamic(() => import('../_sections/Agentes'))

export async function generateMetadata({ params }: { params: Promise<{ section: string }> }): Promise<Metadata> {
  const { section } = await params
  const title = sectionTitle(section)
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
  if (!isValidSection(section)) notFound()

  const stripeError = sp.stripe === 'error' ? (sp.reason ?? 'Error desconocido al conectar Stripe.') : null
  const mpError = sp.mp === 'error' ? (sp.reason ?? 'Error desconocido al conectar Mercado Pago.') : null
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
  // Narrowed alias — `shop` loses its non-null narrowing inside the nested
  // renderExtracted() closure, so capture it here where it's known non-null.
  const shopData = shop

  // Custom-domain paywall: resolve entitlement only for the Canal section (the
  // only section with the domain connect form). When not entitled (flag on, no
  // grant/subscription), Canal renders the upsell instead of the connect form.
  const domainEntitled = section === 'canal'
    ? (await resolveDomainEntitlement(shop.metadata)).entitled
    : true

  const meta = shop.metadata as Record<string, unknown> | null
  const settings = (meta?.settings ?? {}) as Record<string, unknown>
  // Typed view of the settings tree for the extracted sections (each reads only its slice).
  const st = settings as SettingsTree
  const stripeSettings = settings.stripe as { account_id?: string; charges_enabled?: boolean; onboarding_complete?: boolean } | undefined
  const calcomSettings = settings.calcom as { connected?: boolean; username?: string; event_type_title?: string; booking_url?: string } | undefined
  const mpSettings = settings.mercadopago as { connected?: boolean; enabled?: boolean; live_mode?: boolean } | undefined
  // Each extracted section receives only the curated slice it owns (never the raw
  // metadata tree), so secrets — MercadoPago tokens + the hashed MCP agent token —
  // never reach the client. agentTokenSet exposes only the boolean presence.
  const agentTokenSet = !!(meta?.ucp_agent_token_hash)
  const shopRow = shop as unknown as { calcom_api_key: string | null }

  const pageTitle = sectionTitle(section)

  // Each extracted section receives only the slice of the settings tree it owns.
  function renderExtracted() {
    switch (section) {
      case 'politicas':
        return <Devoluciones initial={(st.returns_policy ?? null) as ReturnsPolicySettings | null} />
      case 'perfil':
        return <Perfil initial={{
          name: shopData.name,
          description: (shopData as unknown as { description: string | null }).description ?? '',
          location: (shopData as unknown as { location: string | null }).location,
        }} />
      case 'diseno':
        return <Diseno initial={{
          name: shopData.name,
          logo_url: (shopData as unknown as { logo_url: string | null }).logo_url ?? null,
          theme: st.theme ?? null,
          preset: st.preset ?? null,
          escrow_mode: st.checkout?.escrow_mode ?? null,
          show_phone: st.checkout?.show_phone ?? null,
          phone: st.checkout?.phone ?? null,
          whatsapp_cta: st.checkout?.whatsapp_cta ?? null,
          local_pickup: st.shipping?.local_pickup ?? null,
        }} />
      case 'negociacion':
        return <Negociacion initial={(st.offers ?? null) as OffersSettings | null} />
      case 'envios':
        return <Envios initial={{
          checkout: st.checkout
            ? { show_phone: st.checkout.show_phone, phone: st.checkout.phone, whatsapp_cta: st.checkout.whatsapp_cta, show_email: st.checkout.show_email }
            : null,
          whatsapp: st.theme?.social?.whatsapp ?? null,
          shipping: st.shipping ?? null,
          scheduling_links: st.scheduling?.links ?? [],
        }} />
      case 'citas':
        return <Citas initial={{
          scheduling_links: st.scheduling?.links ?? [],
          calcom_connected: !!(shopRow.calcom_api_key && calcomSettings?.connected),
          calcom_username: calcomSettings?.username ?? null,
          calcom_event_type_title: calcomSettings?.event_type_title ?? null,
          calcom_booking_url: calcomSettings?.booking_url ?? null,
        }} />
      case 'pedidos':
        return <Pedidos initial={(st.orders ?? null) as OrdersSettings | null} />
      case 'notificaciones':
        return <Notificaciones initial={(st.notifications ?? null) as NotificationsSettings | null} />
      case 'pagos':
        return <Pagos
          stripeError={stripeError}
          mpError={mpError}
          initial={{
            stripe: stripeSettings,
            mercadopago: { connected: !!mpSettings?.connected, enabled: mpSettings?.enabled !== false, live_mode: mpSettings?.live_mode },
            checkout: (st.checkout ?? null) as PagosInitial['checkout'],
            local_pickup: st.shipping?.local_pickup,
          }}
        />
      case 'canal':
        return <Canal initial={{
          slug: (shopData as unknown as { slug: string }).slug,
          custom_domain: (shopData as unknown as { custom_domain: string | null }).custom_domain ?? null,
          custom_domain_verified: (shopData as unknown as { custom_domain_verified: boolean }).custom_domain_verified ?? false,
          support: st.support ?? null,
          accent: st.theme?.accent_color ?? null,
          domain_entitled: domainEntitled,
        }} />
      case 'agentes':
        return <Agentes initial={{
          ucp_webhook_url: (shopData as unknown as { ucp_webhook_url: string | null }).ucp_webhook_url ?? null,
          ucp_webhook_secret: (shopData as unknown as { ucp_webhook_secret: string | null }).ucp_webhook_secret ?? null,
          agent_token_set: agentTokenSet,
        }} />
      default:
        return null
    }
  }

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
        <h1 style={{ fontWeight: 700, fontSize: 22, marginTop: 8 }}>{pageTitle}</h1>
      </div>

      {/* Every section renders from its own code-split component. */}
      {renderExtracted()}
    </div>
  )
}
