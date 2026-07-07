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
      <h1 className="text-xl font-bold mt-3 mb-4">Políticas de {shop.name}</h1>

      <section className="border border-[var(--color-border)] rounded-lg p-4">
        <p className="text-sm font-semibold mb-2">Devoluciones</p>
        <p className="text-sm text-[var(--color-muted)] leading-relaxed">
          Acepta devoluciones durante {returnsLabel.toLowerCase()}
          {returnsPolicy?.conditions === 'unopened' ? ' si el producto sigue cerrado' : ''}
          {returnsPolicy?.conditions === 'original' ? ' si se entrega en su estado original' : ''}
          {returnsPolicy?.shipping_paid_by === 'seller' ? '. El vendedor cubre el envío de devolución.' : '. El comprador cubre el envío de devolución.'}
        </p>
        {returnsPolicy?.custom_note && (
          <p className="text-sm text-[var(--fg)] leading-relaxed mt-2">{returnsPolicy.custom_note}</p>
        )}
      </section>
    </div>
  )
}
