'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { ReferralStats } from '@/lib/referrals'

function formatMXN(cents: number | null): string {
  if (cents == null) return ''
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(cents / 100)
}

export default function ReferralsClient({
  code,
  stats,
  siteUrl,
}: {
  code: string | null
  stats: ReferralStats
  siteUrl: string
}) {
  const link = code ? `${siteUrl}/?ref=${code}` : ''
  const [copied, setCopied] = useState(false)

  async function copy() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // Clipboard blocked — selection fallback isn't critical here.
    }
  }

  async function share() {
    if (!link) return
    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      try {
        await (navigator as Navigator & { share: (d: { title: string; text: string; url: string }) => Promise<void> }).share({
          title: 'Miyagi Sánchez',
          text: '¡Únete a Miyagi Sánchez! Compra y vende sin comisiones.',
          url: link,
        })
        return
      } catch {
        // user cancelled — fall through to copy
      }
    }
    copy()
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-8">
      <div className="flex items-center gap-2 mb-1 text-xs text-[var(--color-muted)]">
        <Link href="/account" className="hover:underline no-underline">Mi cuenta</Link>
        <span>/</span>
        <span>Invita y gana</span>
      </div>
      <h1 className="text-2xl font-bold mb-1">Invita y gana</h1>
      <p className="text-sm text-[var(--color-muted)] mb-6">
        Comparte tu enlace. Cuando un amigo se registra y hace su primera compra, ganas crédito para
        tu próximo anuncio en la edición impresa.
      </p>

      {code ? (
        <>
          {/* Share card */}
          <div className="border border-[var(--color-border)] rounded-xl p-5 mb-6">
            <label className="block text-xs font-medium text-[var(--color-muted)] mb-2">Tu enlace de invitación</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 min-w-0 truncate text-sm bg-[var(--color-surface-alt,#f5f5f5)] rounded-lg px-3 py-2">{link}</code>
              <button onClick={copy} className="px-3 py-2 text-sm font-medium rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-surface-alt)] whitespace-nowrap">
                {copied ? '¡Copiado!' : 'Copiar'}
              </button>
            </div>
            <button onClick={share} className="mt-3 w-full px-4 py-2 text-sm font-semibold rounded-lg bg-[var(--color-accent)] text-white hover:opacity-90">
              Compartir
            </button>
            <p className="text-xs text-[var(--color-muted)] mt-3">
              Tu código: <strong className="font-mono">{code}</strong>
            </p>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3 mb-6">
            <Stat label="Invitados" value={stats.invited} />
            <Stat label="Con compra" value={stats.qualified + stats.rewarded} />
            <Stat label="Recompensas" value={stats.rewarded} />
          </div>

          {/* Earned credits */}
          {stats.credits.length > 0 && (
            <div>
              <h2 className="font-semibold mb-2">Tus créditos</h2>
              <ul className="space-y-2">
                {stats.credits.map((c) => (
                  <li key={c.code} className="flex items-center justify-between gap-3 border border-[var(--color-border)] rounded-xl px-4 py-3">
                    <span className="min-w-0">
                      <span className="font-mono font-semibold tracking-wide">{c.code}</span>
                      {c.amount_cents != null && <span className="text-sm text-[var(--color-muted)]"> · {formatMXN(c.amount_cents)} de crédito</span>}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-[var(--color-muted)] mt-3">
                Úsalo en tu próximo <Link href="/account/print-ads" className="underline">anuncio impreso</Link>: ingresa el código al pagar.
              </p>
            </div>
          )}
        </>
      ) : (
        <div className="border border-[var(--color-border)] rounded-xl p-5 text-sm text-[var(--color-muted)]">
          El programa de referidos estará disponible muy pronto. Vuelve en un momento.
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-[var(--color-border)] rounded-xl p-4 text-center">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-[var(--color-muted)] mt-0.5">{label}</div>
    </div>
  )
}
