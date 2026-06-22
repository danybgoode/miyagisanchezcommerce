import { redirect } from 'next/navigation'
import Link from 'next/link'
import { db } from '@/lib/supabase'
import { getDictionary, normalizeLocale } from '@/lib/dictionary'
import { getCampaignStats, getSweepstakesSettings } from '@/lib/sweepstakes'
import { resolveSweepstakesSeller } from '@/lib/sweepstakes-seller'
import SweepstakesManager from './SweepstakesManager'

export const metadata = {
  title: 'Sorteos - Mi tienda',
}

export const dynamic = 'force-dynamic'

export default async function SweepstakesManagePage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>
}) {
  const { lang } = await searchParams
  const locale = normalizeLocale(lang)
  const dict = await getDictionary(locale)
  const context = await resolveSweepstakesSeller()
  if (!context) redirect('/sell')

  const [{ data: campaigns }, settings] = await Promise.all([
    db
      .from('marketplace_sweepstakes_campaigns')
      .select('*')
      .eq('shop_id', context.shop.id)
      .order('created_at', { ascending: false }),
    getSweepstakesSettings(),
  ])

  const initialCampaigns = await Promise.all((campaigns ?? []).map(async (campaign) => ({
    ...campaign,
    stats: await getCampaignStats(campaign.id),
  })))

  return (
    <main>
      <div className="max-w-5xl mx-auto px-4 pt-8">
        <div className="flex items-center gap-2 mb-1 text-xs text-[var(--color-muted)]">
          <Link href="/shop/manage" className="hover:underline no-underline">{dict.sweepstakes.seller.breadcrumbHome}</Link>
          <span>/</span>
          <span>{dict.sweepstakes.seller.breadcrumbCurrent}</span>
        </div>
      </div>
      <SweepstakesManager
        ui={dict.sweepstakes.seller}
        initialCampaigns={initialCampaigns}
        settings={settings}
      />
    </main>
  )
}
