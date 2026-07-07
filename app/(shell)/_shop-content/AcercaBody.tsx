import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Shop } from '@/lib/types'

/**
 * Shared body for both Acerca routes (own-shop premium presentation, Sprint 3):
 *  - `app/(shell)/s/[slug]/acerca/page.tsx` — marketplace path.
 *  - `app/(shell)/acerca/page.tsx` — channel path (subdomain/custom domain),
 *    shop already resolved from the unspoofable `x-miyagi-shop-slug` header;
 *    falls through to the platform About page when that header is absent.
 *
 * Unauthored (`about.body` empty) → notFound() — never a dead nav link, since
 * the nav only links here when `about.body` is truthy.
 */
export default function AcercaBody({ shop, basePath }: { shop: Shop; basePath: string }) {
  const settings = ((shop.metadata as Record<string, unknown> | null)?.settings ?? {}) as Record<string, unknown>
  const about = settings.about as { body?: string } | null | undefined
  const body = about?.body?.trim()
  if (!body) notFound()

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Link href={basePath || '/'} className="text-sm text-[var(--color-muted)] no-underline hover:underline">
        ← {shop.name}
      </Link>
      <h1 className="text-xl font-bold mt-3 mb-4">Acerca de {shop.name}</h1>
      <p className="text-sm leading-relaxed whitespace-pre-line">{body}</p>
    </div>
  )
}
