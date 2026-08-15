'use client'

/** Presentational, in-memory pagination control shared by client-admin lists. */
export default function AdminPagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number
  totalPages: number
  onPageChange: (page: number) => void
}) {
  if (totalPages <= 1) return null

  return (
    <div className="flex gap-1 justify-center flex-wrap">
      {page > 1 && (
        <button type="button" onClick={() => onPageChange(page - 1)} className="btn btn-secondary btn-sm">
          ← Anterior
        </button>
      )}
      {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
        const windowStart = Math.max(1, Math.min(page - 2, totalPages - 4))
        const p = windowStart + i
        return (
          <button
            key={p}
            type="button"
            onClick={() => onPageChange(p)}
            className={p === page ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
            aria-current={p === page ? 'page' : undefined}
          >
            {p}
          </button>
        )
      })}
      {page < totalPages && (
        <button type="button" onClick={() => onPageChange(page + 1)} className="btn btn-secondary btn-sm">
          Siguiente →
        </button>
      )}
    </div>
  )
}
