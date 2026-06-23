import { redirect } from 'next/navigation'
import { db } from '@/lib/supabase'
import { SellerBreadcrumb } from '../SellerBreadcrumb'
import { getDictionary, normalizeLocale } from '@/lib/dictionary'
import { getEventStats, publicEventUrl } from '@/lib/events'
import { resolveEventSeller } from '@/lib/events-seller'
import type { MarketplaceEvent } from '@/lib/events-types'
import EventsManager from './EventsManager'

export const metadata = {
  title: 'Eventos - Mi tienda',
}

export const dynamic = 'force-dynamic'

export default async function EventsManagePage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>
}) {
  const { lang } = await searchParams
  const locale = normalizeLocale(lang)
  const dict = await getDictionary(locale)
  const context = await resolveEventSeller()
  if (!context) redirect('/sell')

  const { data: events } = await db
    .from('marketplace_events')
    .select('*')
    .eq('shop_id', context.shop.id)
    .order('created_at', { ascending: false })

  const initialEvents = await Promise.all(((events ?? []) as MarketplaceEvent[]).map(async (event) => ({
    ...event,
    public_url: publicEventUrl(event.slug, locale),
    stats: await getEventStats(event),
  })))

  return (
    <main>
      <div className="max-w-5xl mx-auto px-4 pt-8">
        <SellerBreadcrumb
          crumbs={[
            { label: dict.events.seller.breadcrumbHome, href: '/shop/manage' },
            { label: dict.events.seller.breadcrumbCurrent, href: null },
          ]}
        />
      </div>
      <EventsManager
        ui={dict.events.seller}
        initialEvents={initialEvents}
      />
    </main>
  )
}
