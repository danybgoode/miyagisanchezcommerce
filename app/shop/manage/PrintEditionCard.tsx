'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { PrintEditionPublic } from '@/lib/print'

function formatMXN(cents: number): string {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(cents / 100)
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'long' })
}

/**
 * Seller-portal entry point for "Sal en la edición impresa". Self-fetches the open
 * editions and deep-links into the ad builder. Renders nothing when no edition is open.
 */
export default function PrintEditionCard() {
  const [editions, setEditions] = useState<PrintEditionPublic[] | null>(null)

  useEffect(() => {
    let active = true
    fetch('/api/print/editions?status=open')
      .then((r) => (r.ok ? r.json() : { editions: [] }))
      .then((d) => { if (active) setEditions(d.editions ?? []) })
      .catch(() => { if (active) setEditions([]) })
    return () => { active = false }
  }, [])

  if (!editions || editions.length === 0) return null

  return (
    <div className="mb-8 rounded-2xl border border-[var(--color-border)] overflow-hidden">
      <div className="bg-gradient-to-r from-[#0a4d2e] to-[#16a34a] px-5 py-4 text-white">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest opacity-90">
          <span>🗞️</span> Edición impresa · México 86
        </div>
        <h2 className="mt-1 text-lg font-bold">Sal en la revista impresa de tu ciudad</h2>
        <p className="text-sm text-white/85">
          Diseñamos tu anuncio y lo publicamos en la edición local. QR y WhatsApp directo a tu tienda.
        </p>
      </div>

      <div className="divide-y divide-[var(--color-border)]">
        {editions.map((ed) => {
          const deadline = formatDate(ed.submission_deadline)
          const distrib = formatDate(ed.distribution_date)
          const fromPrice = ed.tiers.filter((t) => !t.sold_out).reduce<number | null>(
            (min, t) => (min === null ? t.price_cents : Math.min(min, t.price_cents)), null)
          const allSoldOut = ed.tiers.every((t) => t.sold_out)
          return (
            <div key={ed.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{ed.title}</h3>
                  <p className="text-xs text-[var(--color-muted)] mt-0.5">
                    {ed.provider_name}
                    {ed.coverage_zones.length > 0 && <> · {ed.coverage_zones.join(', ')}</>}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-muted)]">
                    {deadline && <span>📅 Cierra: <strong className="text-[var(--color-foreground)]">{deadline}</strong></span>}
                    {distrib && <span>📍 Distribución: <strong className="text-[var(--color-foreground)]">{distrib}</strong></span>}
                  </div>
                </div>
                {fromPrice !== null && (
                  <div className="text-right flex-shrink-0">
                    <div className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">Desde</div>
                    <div className="text-lg font-bold">{formatMXN(fromPrice)}</div>
                  </div>
                )}
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {ed.tiers.map((t) => (
                  <span
                    key={t.key}
                    className={`text-xs px-2.5 py-1 rounded-full border ${
                      t.sold_out
                        ? 'border-[var(--color-border)] text-[var(--color-muted)] line-through'
                        : 'border-[var(--color-border)] text-[var(--color-foreground)]'
                    }`}
                    title={t.sold_out ? 'Agotado' : `${t.remaining} disponibles`}
                  >
                    {t.label} · {formatMXN(t.price_cents)}{t.sold_out ? ' · agotado' : ''}
                  </span>
                ))}
              </div>

              {allSoldOut ? (
                <p className="mt-4 text-sm text-[var(--color-muted)]">Esta edición está agotada. ¡Atento a la próxima!</p>
              ) : (
                <Link
                  href={`/sell/print/${ed.id}`}
                  className="mt-4 inline-block bg-[var(--color-accent)] text-white px-5 py-2 rounded-lg text-sm font-semibold no-underline hover:bg-[var(--color-accent-hover)] transition-colors"
                >
                  Diseñar mi anuncio →
                </Link>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
