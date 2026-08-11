import { BuyerCopyText } from '@/app/components/BuyerPresentationContext'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { returnsWindowLabel } from '@/lib/trust-signals'
import type { Shop } from '@/lib/types'

/**
 * Shared body for both Políticas routes (own-shop premium presentation,
 * Sprint 3):
 *  - `app/(shell)/s/[slug]/politicas/page.tsx` — marketplace path.
 *  - `app/(shell)/politicas/page.tsx` — channel path (subdomain/custom domain).
 *
 * Merchandises the EXISTING Devoluciones (`returns_policy`) setting as a real
 * page — there is no separate "políticas" authored field (never duplicated).
 * Reuses `returnsWindowLabel()` (lib/trust-signals.ts), the same helper the
 * PDP trust chip uses, so the two surfaces can't drift on the window label.
 * Unauthored (no window set) → notFound() — never a dead nav link.
 */
export default function PoliticasBody({ shop, basePath }: { shop: Shop; basePath: string }) {
  const settings = ((shop.metadata as Record<string, unknown> | null)?.settings ?? {}) as Record<string, unknown>
  const returnsPolicy = settings.returns_policy as
    | { window?: string; conditions?: string; shipping_paid_by?: 'buyer' | 'seller'; custom_note?: string | null }
    | null
    | undefined
  const returnsLabel = returnsWindowLabel(returnsPolicy?.window)
  if (!returnsLabel) notFound()

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Link href={basePath || '/'} className="text-sm text-[var(--color-muted)] no-underline hover:underline">
        ← {shop.name}
      </Link>
      <h1 className="text-xl font-bold mt-3 mb-4"><BuyerCopyText copyKey="shop.content.PoliticasBody.9fc9fbd4" />{' '}{shop.name}</h1>

      <section className="border border-[var(--color-border)] rounded-lg p-4">
        <p className="text-sm font-semibold mb-2"><BuyerCopyText copyKey="shop.content.PoliticasBody.3467fca9" /></p>
        <p className="text-sm text-[var(--color-muted)] leading-relaxed">
          <BuyerCopyText copyKey="shop.content.PoliticasBody.0376bca7" />{' '}{returnsLabel.toLowerCase()}
          {returnsPolicy?.conditions === 'unopened' ? <BuyerCopyText copyKey="shop.content.PoliticasBody.b6b14aaa" /> : ''}
          {returnsPolicy?.conditions === 'original' ? <BuyerCopyText copyKey="shop.content.PoliticasBody.c41d95bc" /> : ''}
          {returnsPolicy?.shipping_paid_by === 'seller' ? <BuyerCopyText copyKey="shop.content.PoliticasBody.bd851b88" /> : <BuyerCopyText copyKey="shop.content.PoliticasBody.9b918784" />}
        </p>
        {returnsPolicy?.custom_note && (
          <p className="text-sm text-[var(--fg)] leading-relaxed mt-2">{returnsPolicy.custom_note}</p>
        )}
      </section>
    </div>
  )
}
