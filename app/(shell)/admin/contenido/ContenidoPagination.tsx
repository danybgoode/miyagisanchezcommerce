import Link from 'next/link'
import { buildContenidoPageUrl, type ContenidoSearchParams } from '@/lib/copy-overrides-admin-view'

/**
 * Numbered-pill pagination for `/admin/contenido` (epic 08 ·
 * cms-contenido-restore-and-polish, Story 2.1) — same shape as
 * `FlagsPagination.tsx` (windowed to 5 pages centered on the current one,
 * ← Anterior / Siguiente → at the ends). Rendered both above and below the
 * list so a long key list doesn't force a scroll-to-bottom just to see how
 * many pages there are.
 */
export default function ContenidoPagination({
  params,
  page,
  totalPages,
  className = '',
}: {
  params: ContenidoSearchParams
  page: number
  totalPages: number
  className?: string
}) {
  if (totalPages <= 1) return null

  return (
    <div className={`flex gap-1 justify-center flex-wrap ${className}`.trim()}>
      {page > 1 && (
        <Link href={buildContenidoPageUrl(params, page - 1)} className="btn btn-secondary btn-sm no-underline">
          ← Anterior
        </Link>
      )}
      {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
        // Clamp the window's start so it never shrinks below 5 pages near the
        // END of a long list too (page-2 alone only guards the start).
        const windowStart = Math.max(1, Math.min(page - 2, totalPages - 4))
        const p = windowStart + i
        return (
          <Link
            key={p}
            href={buildContenidoPageUrl(params, p)}
            className={p === page ? 'btn btn-primary btn-sm no-underline' : 'btn btn-secondary btn-sm no-underline'}
          >
            {p}
          </Link>
        )
      })}
      {page < totalPages && (
        <Link href={buildContenidoPageUrl(params, page + 1)} className="btn btn-secondary btn-sm no-underline">
          Siguiente →
        </Link>
      )}
    </div>
  )
}
