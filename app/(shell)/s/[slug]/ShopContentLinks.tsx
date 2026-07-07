import Link from 'next/link'

/**
 * Footer nav row linking to whichever content pages are authored (own-shop
 * premium presentation, Sprint 3) — Acerca / FAQ / Políticas. Unauthored pages
 * are simply absent from `pages` (computed by the caller), so there is never a
 * dead link; renders nothing when nothing is authored.
 */
export default function ShopContentLinks({
  basePath,
  pages,
}: {
  basePath: string
  pages: Array<{ href: string; label: string }>
}) {
  if (pages.length === 0) return null

  return (
    <div className="max-w-6xl mx-auto px-4 pb-8">
      <div className="border-t border-[var(--color-border)] pt-4 flex items-center gap-4 flex-wrap">
        {pages.map((p) => (
          <Link
            key={p.href}
            href={`${basePath}${p.href}`}
            className="text-xs text-[var(--color-muted)] no-underline hover:underline"
          >
            {p.label}
          </Link>
        ))}
      </div>
    </div>
  )
}
