type SellerPageSkeletonVariant = 'dashboard' | 'list' | 'table' | 'form' | 'detail'

function Bone({ className }: { className: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />
}

function HeaderSkeleton() {
  return (
    <div className="space-y-3">
      <Bone className="h-3 w-28 rounded" />
      <Bone className="h-7 w-48 rounded-[var(--r-sm)]" />
      <Bone className="h-4 w-72 max-w-full rounded" />
    </div>
  )
}

/**
 * Route-transition placeholder for the seller workspace. It deliberately uses
 * the portal's own spacing, radii, and global `.skeleton` motion instead of a
 * second loading language or a global busy indicator that replaces the stable seller shell.
 */
export function SellerPageSkeleton({ variant = 'dashboard' }: { variant?: SellerPageSkeletonVariant }) {
  const rows = variant === 'detail' ? 3 : 5

  return (
    <div
      className="mx-auto w-full max-w-5xl px-4 py-8"
      aria-label="Cargando contenido"
      aria-busy="true"
      role="status"
      data-seller-skeleton={variant}
    >
      <span className="sr-only">Cargando contenido…</span>
      <HeaderSkeleton />

      {variant === 'dashboard' && (
        <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((key) => (
            <div key={key} className="card-panel space-y-4 p-5">
              <Bone className="h-10 w-10 rounded-[var(--r-md)]" />
              <Bone className="h-5 w-2/3 rounded" />
              <Bone className="h-3 w-full rounded" />
              <Bone className="h-3 w-4/5 rounded" />
            </div>
          ))}
        </div>
      )}

      {(variant === 'list' || variant === 'table' || variant === 'detail') && (
        <div className="mt-7 overflow-hidden rounded-[var(--r-lg)] border border-[var(--color-border)] bg-[var(--bg-elevated)]">
          {Array.from({ length: rows }, (_, key) => (
            <div key={key} className="flex min-h-20 items-center gap-4 border-b border-[var(--color-border)] p-4 last:border-0">
              <Bone className="h-11 w-11 shrink-0 rounded-[var(--r-md)]" />
              <div className="min-w-0 flex-1 space-y-2">
                <Bone className="h-4 w-2/3 rounded" />
                <Bone className="h-3 w-1/2 rounded" />
              </div>
              <Bone className="h-7 w-20 rounded-[var(--r-pill)]" />
            </div>
          ))}
        </div>
      )}

      {variant === 'form' && (
        <div className="card-panel mt-7 space-y-5 p-5 sm:p-7">
          {[0, 1, 2, 3].map((key) => (
            <div key={key} className="space-y-2">
              <Bone className="h-3 w-28 rounded" />
              <Bone className="h-11 w-full rounded-[var(--r-sm)]" />
            </div>
          ))}
          <Bone className="ml-auto h-10 w-36 rounded-[var(--r-pill)]" />
        </div>
      )}
    </div>
  )
}
