import Link from 'next/link'
import { buildFlagsPageUrl, type FlagsSearchParams } from '@/lib/flags-admin-view'

/**
 * Numbered-pill pagination for `/admin/flags` — same shape as the bottom
 * pagination on `/shop/manage/catalogo` (windowed to 5 pages centered on the
 * current one, ← Anterior / Siguiente → at the ends). Rendered both above and
 * below the table here (unlike Catálogo, which is bottom-only) so a long
 * flag list doesn't force a scroll-to-bottom just to see how many pages there are.
 */
export default function FlagsPagination({
  params,
  page,
  totalPages,
  className = '',
}: {
  params: FlagsSearchParams
  page: number
  totalPages: number
  className?: string
}) {
  if (totalPages <= 1) return null

  return (
    <div className={`flex gap-1 justify-center flex-wrap ${className}`.trim()}>
      {page > 1 && (
        <Link href={buildFlagsPageUrl(params, page - 1)} className="btn btn-secondary btn-sm no-underline">
          ← Anterior
        </Link>
      )}
      {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
        const p = Math.max(1, page - 2) + i
        return p <= totalPages ? (
          <Link
            key={p}
            href={buildFlagsPageUrl(params, p)}
            className={p === page ? 'btn btn-primary btn-sm no-underline' : 'btn btn-secondary btn-sm no-underline'}
          >
            {p}
          </Link>
        ) : null
      })}
      {page < totalPages && (
        <Link href={buildFlagsPageUrl(params, page + 1)} className="btn btn-secondary btn-sm no-underline">
          Siguiente →
        </Link>
      )}
    </div>
  )
}
