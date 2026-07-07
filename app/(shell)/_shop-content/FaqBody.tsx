import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Shop } from '@/lib/types'

/**
 * Shared body for both FAQ routes (own-shop premium presentation, Sprint 3):
 *  - `app/(shell)/s/[slug]/faq/page.tsx` — marketplace path.
 *  - `app/(shell)/faq/page.tsx` — channel path (subdomain/custom domain).
 *
 * Unauthored (no `faq.items`) → notFound() — never a dead nav link.
 */
export default function FaqBody({ shop, basePath }: { shop: Shop; basePath: string }) {
  const settings = ((shop.metadata as Record<string, unknown> | null)?.settings ?? {}) as Record<string, unknown>
  const faq = settings.faq as { items?: Array<{ question: string; answer: string }> } | null | undefined
  const items = faq?.items ?? []
  if (items.length === 0) notFound()

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Link href={basePath || '/'} className="text-sm text-[var(--color-muted)] no-underline hover:underline">
        ← {shop.name}
      </Link>
      <h1 className="text-xl font-bold mt-3 mb-4">Preguntas frecuentes</h1>
      <div className="space-y-4">
        {items.map((item, i) => (
          <div key={i} className="border border-[var(--color-border)] rounded-lg p-4">
            <p className="text-sm font-semibold mb-1">{item.question}</p>
            <p className="text-sm text-[var(--color-muted)] leading-relaxed whitespace-pre-line">{item.answer}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
