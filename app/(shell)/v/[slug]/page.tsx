import Link from 'next/link'
import { db } from '@/lib/supabase'
import { isEnabled } from '@/lib/flags'
import { getListing } from '@/lib/listings'
import { excerptModel } from '@/lib/excerpt'
import { getCampaignBySlug } from '@/lib/launchpad-campaigns'
import { campaignAcceptsVotes } from '@/lib/launchpad-campaign-types'
import VoteClient, { type CampaignWorkView } from './VoteClient'

export const dynamic = 'force-dynamic'

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://miyagisanchez.com').replace(/\/+$/, '')
const EXCERPT_SNIPPET = 400

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  if (!(await isEnabled('launchpad.enabled'))) return { title: 'Campaña — Miyagi Sánchez' }
  const campaign = await getCampaignBySlug(slug)
  if (!campaign) return { title: 'Campaña — Miyagi Sánchez' }
  return {
    title: `${campaign.title ?? 'Vota'} — Miyagi Sánchez`,
    description: campaign.description ?? undefined,
    openGraph: {
      title: campaign.title ?? 'Vota por el próximo libro',
      description: campaign.description ?? undefined,
      url: `${SITE_URL}/v/${campaign.slug}`,
    },
  }
}

function StateMessage({ text }: { text: string }) {
  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-12 bg-[var(--color-background)]">
      <div className="max-w-md w-full border border-[var(--color-border)] rounded-xl p-6 text-center">
        <Link href="/" className="text-xs text-[var(--color-muted)] no-underline hover:underline">miyagisanchez.com</Link>
        <h1 className="mt-4 text-xl font-semibold">{text}</h1>
      </div>
    </main>
  )
}

export default async function CampaignPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  // Dark-launch: the whole public surface is invisible until launchpad.enabled.
  if (!(await isEnabled('launchpad.enabled'))) return <StateMessage text="Esta página no está disponible." />

  const campaign = await getCampaignBySlug(slug)
  if (!campaign) return <StateMessage text="No encontramos esta campaña." />
  if (campaign.status === 'draft') return <StateMessage text="Esta campaña aún no está publicada." />

  // Resolve each candidate work: title + a short excerpt snippet + a PDP link.
  const works: CampaignWorkView[] = (
    await Promise.all(
      campaign.works.map(async (w): Promise<CampaignWorkView | null> => {
        const listing = await getListing(w.product_id)
        if (!listing) return null
        const excerpt = excerptModel(listing.metadata)
        const snippet = excerpt?.text ? excerpt.text.slice(0, EXCERPT_SNIPPET).trim() : null
        return {
          productId: w.product_id,
          title: listing.title,
          image: listing.images?.[0]?.url ?? null,
          href: `/l/${w.product_id}`,
          excerptSnippet: snippet,
          hasMoreExcerpt: !!excerpt?.text && excerpt.text.length > EXCERPT_SNIPPET,
        }
      }),
    )
  ).filter((w): w is CampaignWorkView => w !== null)

  const { data: shop } = await db
    .from('marketplace_shops')
    .select('slug, name')
    .eq('id', campaign.shop_id)
    .maybeSingle()

  const closed = campaign.status === 'closed_met' || campaign.status === 'closed_unmet' || campaign.status === 'cancelled'

  return (
    <VoteClient
      slug={campaign.slug}
      title={campaign.title ?? 'Vota por el próximo libro'}
      description={campaign.description}
      terms={campaign.terms}
      threshold={campaign.vote_threshold}
      voteCount={campaign.vote_count}
      rewardPercent={campaign.reward_percent}
      endsAt={campaign.ends_at}
      status={campaign.status}
      open={campaignAcceptsVotes(campaign)}
      closed={closed}
      works={works}
      shopName={shop?.name ?? null}
      shopUrl={shop?.slug ? `/s/${shop.slug}` : null}
      publicUrl={`${SITE_URL}/v/${campaign.slug}`}
    />
  )
}
