import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getDictionary, normalizeLocale } from '@/lib/dictionary'
import { getFreeEventRoster } from '@/lib/event-tickets'
import { getSellerEvent } from '@/lib/events-seller'
import { getPaidTicketRosterForSeller } from '@/lib/paid-event-tickets'
import EventRosterClient from './EventRosterClient'

export const metadata = {
  title: 'Asistencia - Eventos',
}

export const dynamic = 'force-dynamic'

export default async function EventRosterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ lang?: string }>
}) {
  const [{ id }, { lang }] = await Promise.all([params, searchParams])
  const locale = normalizeLocale(lang)
  const dict = await getDictionary(locale)
  const found = await getSellerEvent(id)
  if (!found) redirect('/shop/manage/eventos')
  const sellerContext = found.context
  if (!sellerContext) redirect('/shop/manage/eventos')

  const [freeRows, paidRows] = await Promise.all([
    getFreeEventRoster(id),
    getPaidTicketRosterForSeller({ sellerId: sellerContext.seller.id, eventOrProductId: id }),
  ])

  return (
    <main>
      <div className="max-w-5xl mx-auto px-4 pt-8">
        <div className="flex items-center gap-2 mb-1 text-xs text-[var(--color-muted)]">
          <Link href="/shop/manage" className="hover:underline no-underline">{dict.events.seller.breadcrumbHome}</Link>
          <span>/</span>
          <Link href="/shop/manage/eventos" className="hover:underline no-underline">{dict.events.seller.breadcrumbCurrent}</Link>
          <span>/</span>
          <span>{dict.events.seller.roster}</span>
        </div>
        <h1 className="text-2xl font-bold">{found.event.title}</h1>
      </div>
      <EventRosterClient
        eventId={id}
        ui={dict.events.seller}
        initialRoster={[...freeRows, ...paidRows]}
      />
    </main>
  )
}
