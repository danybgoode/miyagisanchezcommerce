/** Shared settings section heading — moved verbatim from the ShopSettings monolith. */

import type { ReactNode } from 'react'

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="font-semibold text-sm uppercase tracking-wide text-[var(--color-muted)] mb-3">
      {children}
    </h2>
  )
}
