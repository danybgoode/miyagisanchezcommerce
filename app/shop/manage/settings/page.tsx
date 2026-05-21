import { redirect } from 'next/navigation'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import ShopSettingsPanel from './ShopSettings'

export const metadata = {
  title: 'Configuración de tienda — Miyagi Sánchez',
}

export default async function SettingsPage() {
  const user = await currentUser()
  if (!user) redirect('/sign-in')

  const { data: shop } = await db
    .from('marketplace_shops')
    .select('id, name, description, location, logo_url, metadata, mp_enabled, ucp_webhook_url, ucp_webhook_secret')
    .eq('clerk_user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!shop) redirect('/sell')

  // Extract Stripe settings from metadata JSONB
  const meta = shop.metadata as Record<string, unknown> | null
  const stripeSettings = (meta?.settings as Record<string, unknown> | undefined)?.stripe as {
    account_id?: string
    charges_enabled?: boolean
    onboarding_complete?: boolean
  } | undefined

  return (
    <ShopSettingsPanel
      initial={{
        name: shop.name,
        description: shop.description ?? '',
        location: shop.location,
        logo_url: shop.logo_url,
        mp_enabled: (shop as unknown as { mp_enabled: boolean | null }).mp_enabled ?? true,
        ucp_webhook_url: (shop as unknown as { ucp_webhook_url: string | null }).ucp_webhook_url ?? null,
        ucp_webhook_secret: (shop as unknown as { ucp_webhook_secret: string | null }).ucp_webhook_secret ?? null,
        stripe: stripeSettings,
        metadata: shop.metadata as NonNullable<typeof shop.metadata> | null,
      }}
    />
  )
}
