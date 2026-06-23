'use client'

/**
 * The one breadcrumb every `/shop/manage/*` section renders — "Resumen / <Section>",
 * derived from the nav SSOT (`lib/seller-nav.ts`) so it can't drift from the rail.
 * Replaces the six+ bespoke back-links/breadcrumbs the sections used to hand-roll.
 *
 * Usage:
 *  - es-MX sections: `<SellerBreadcrumb />` — derives the trail from `usePathname`.
 *  - deeper pages: `<SellerBreadcrumb extra={[{ label: 'a1b2c3d…', href: null }]} />`
 *    appends a crumb after the section (order id, settings sub-section); the section
 *    crumb stays a link.
 *  - bilingual server pages (eventos/sweepstakes): pass `crumbs` directly with the
 *    dict-resolved labels — the markup stays single-sourced here.
 */

import Link from 'next/link'
import { Fragment } from 'react'
import { usePathname } from 'next/navigation'
import { sellerBreadcrumbTrail, type SellerCrumb } from '@/lib/seller-nav'

export function SellerBreadcrumb({
  extra,
  crumbs,
  className,
}: {
  extra?: SellerCrumb[]
  crumbs?: SellerCrumb[]
  className?: string
}) {
  const pathname = usePathname()
  const trail = crumbs ?? sellerBreadcrumbTrail(pathname ?? '', extra)

  return (
    <nav
      aria-label="Migas de pan"
      className={`flex items-center gap-2 mb-1 text-xs text-[var(--color-muted)] ${className ?? ''}`}
    >
      {trail.map((crumb, i) => (
        <Fragment key={`${crumb.label}-${i}`}>
          {i > 0 && <span aria-hidden>/</span>}
          {crumb.href ? (
            <Link href={crumb.href} className="hover:underline no-underline">
              {crumb.label}
            </Link>
          ) : (
            <span aria-current="page">{crumb.label}</span>
          )}
        </Fragment>
      ))}
    </nav>
  )
}
