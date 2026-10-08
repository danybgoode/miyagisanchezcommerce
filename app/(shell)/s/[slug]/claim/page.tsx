import { BuyerCopyText } from '@/app/components/BuyerPresentationContext'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { readShopFresh } from '@/lib/listings'
import { assertShopNotPreviewPrivate } from '@/lib/preview-access'
import { readPublicSellerMarket } from '@/lib/owned-market'
import type { MarketCode } from '@/lib/markets'
import { CONTACT_EMAIL } from '@/lib/contact'
import { signClaimToken } from '@/lib/claimJwt'

export async function ClaimPage({
  params,
  market,
  marketBasePath = '',
}: {
  params: Promise<{ slug: string }>
  market?: MarketCode
  marketBasePath?: string
}) {
  const { slug } = await params
  const shopRead = await readShopFresh(slug, market)
  if (shopRead.state === 'absent') notFound()
  if (shopRead.state === 'unavailable') return <main className="max-w-lg mx-auto px-4 py-12">
    <h1 className="text-xl font-bold"><BuyerCopyText copyKey="s.slug.claim.page.shopUnavailable" /></h1>
    <p className="mt-3"><BuyerCopyText copyKey="s.slug.claim.page.tryAgain" /> <a href={`mailto:${CONTACT_EMAIL}`}><BuyerCopyText copyKey="s.slug.claim.page.writeToUs" /></a>.</p>
  </main>
  const shop = shopRead.shop
  const shopMarket = readPublicSellerMarket(shop)?.market_code
  if (!shop.verified || !shopMarket || (market && shopMarket !== market)) notFound()
  // Consent-safe previews: a preview-private shop must not expose its name or
  // a claim action before the merchant has approved being presented at all.
  await assertShopNotPreviewPrivate(shop)

  if (shop.clerk_user_id) {
    return (
      <div className="max-w-lg mx-auto px-4 py-12">
        <nav className="text-sm text-[var(--color-muted)] mb-6">
          <Link href={`${marketBasePath}/s/${slug}`} className="hover:text-[var(--color-text)]">{shop.name}</Link>
          {' › '}
          <span><BuyerCopyText copyKey="s.slug.claim.page.9d65fc41" /></span>
        </nav>

        {/* Already claimed — Google My Business pattern */}
        <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
          {/* Header */}
          <div className="bg-[var(--color-background)] px-5 py-4 border-b border-[var(--color-border)] flex items-center gap-3">
            <i className="iconoir-shop text-2xl" aria-hidden />
            <div>
              <p className="font-bold text-[var(--color-text)]">{shop.name}</p>
              <p className="text-xs text-[var(--color-muted)]"><BuyerCopyText copyKey="s.slug.claim.page.7b23458e" />{marketBasePath}<BuyerCopyText copyKey="s.slug.claim.page.3c747a4a" />{slug}</p>
            </div>
            <span className="ml-auto text-xs font-semibold bg-[var(--accent)] text-[color:var(--fg-inverse)] px-2 py-0.5 rounded">
              <BuyerCopyText copyKey="s.slug.claim.page.1d7a0f48" /></span>
          </div>

          {/* Body: is it you? */}
          <div className="px-5 py-5 space-y-5">
            <div className="flex items-start gap-3 p-4 bg-[var(--claim-accent-soft)] border border-[var(--claim-accent-border)] rounded-lg">
              <i className="iconoir-user text-xl mt-0.5" aria-hidden />
              <div>
                <p className="text-sm font-semibold text-[var(--color-text)] mb-1">
                  <BuyerCopyText copyKey="s.slug.claim.page.9d497a0a" /></p>
                <p className="text-xs text-[var(--color-muted)] mb-3">
                  <BuyerCopyText copyKey="s.slug.claim.page.afb27b70" /></p>
                <a
                  href="/shop/manage"
                  className="btn btn-primary"
                >
                  <BuyerCopyText copyKey="s.slug.claim.page.bf32221c" /></a>
              </div>
            </div>

            <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <i className="iconoir-warning-triangle text-xl mt-0.5" aria-hidden />
              <div>
                <p className="text-sm font-semibold text-[var(--color-text)] mb-1">
                  <BuyerCopyText copyKey="s.slug.claim.page.a448fe6f" /></p>
                <p className="text-xs text-[var(--color-muted)] mb-2">
                  <BuyerCopyText copyKey="s.slug.claim.page.073db7eb" /></p>
                <a
                  href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`Recuperar tienda: ${shop.name}`)}`}
                  className="text-sm font-semibold text-amber-700 no-underline hover:underline"
                >
                  <BuyerCopyText copyKey="s.slug.claim.page.dbdc2f7f" /></a>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-5 py-3 border-t border-[var(--color-border)] bg-[var(--color-background)]">
            <Link href={`${marketBasePath}/s/${slug}`} className="text-sm text-[var(--color-muted)] hover:text-[var(--color-text)] no-underline">
              <BuyerCopyText copyKey="s.slug.claim.page.9004ef36" /></Link>
          </div>
        </div>
      </div>
    )
  }

  if (!process.env.CLAIM_JWT_SECRET) return <main className="max-w-lg mx-auto px-4 py-12">
    <h1 className="text-xl font-bold"><BuyerCopyText copyKey="s.slug.claim.page.claimUnavailable" /></h1>
    <p className="mt-3"><BuyerCopyText copyKey="s.slug.claim.page.tryAgain" /> <a href={`mailto:${CONTACT_EMAIL}`}><BuyerCopyText copyKey="s.slug.claim.page.writeToUs" /></a>.</p>
  </main>
  const token = await signClaimToken({
    shopId: shop.id, shopSlug: shop.slug, shopName: shop.name,
    market: shopMarket, purpose: 'public',
  }, null)

  return (
    <div className="max-w-lg mx-auto px-4 py-12">
      <nav className="text-sm text-[var(--color-muted)] mb-6">
        <Link href={`${marketBasePath}/s/${slug}`} className="hover:text-[var(--color-text)]">{shop.name}</Link>
        {' › '}
        <span><BuyerCopyText copyKey="s.slug.claim.page.9d65fc41" /></span>
      </nav>
      <h1 className="text-xl font-bold mb-1"><BuyerCopyText copyKey="s.slug.claim.page.a55f87d9" /></h1>
      <p className="text-base font-semibold text-[var(--color-text)] mb-1">{shop.name}</p>
      <p className="text-sm text-[var(--color-muted)] mb-6">
        <BuyerCopyText copyKey="s.slug.claim.page.753ab0d9" /></p>
      <Link href={`/claim?token=${encodeURIComponent(token)}`} className="btn btn-primary inline-flex">
        <BuyerCopyText copyKey="s.slug.ClaimForm.f2f2fc2f" />
      </Link>
    </div>
  )
}

export default ClaimPage
