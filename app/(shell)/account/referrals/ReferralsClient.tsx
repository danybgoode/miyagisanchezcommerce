'use client'

import { BuyerCopyText, useBuyerFormatters } from '@/app/components/BuyerPresentationContext'
import { useState } from 'react'
import Link from 'next/link'
import type { ReferralStats } from '@/lib/referrals'

export default function ReferralsClient({
  code,
  stats,
  siteUrl,
}: {
  code: string | null
  stats: ReferralStats
  siteUrl: string
}) {
  const formatters = useBuyerFormatters()
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
        <Link href="/account" className="hover:underline no-underline"><BuyerCopyText copyKey="account.referrals.ReferralsClient.02eea7e4" /></Link>
        <span>/</span>
        <span><BuyerCopyText copyKey="account.referrals.ReferralsClient.7dc48d64" /></span>
      </div>
      <h1 className="text-2xl font-bold mb-1"><BuyerCopyText copyKey="account.referrals.ReferralsClient.7dc48d64" /></h1>
      <p className="text-sm text-[var(--color-muted)] mb-6">
        <BuyerCopyText copyKey="account.referrals.ReferralsClient.76f3feb0" /></p>

      {code ? (
        <>
          {/* Share card */}
          <div className="border border-[var(--color-border)] rounded-xl p-5 mb-6">
            <label className="block text-xs font-medium text-[var(--color-muted)] mb-2"><BuyerCopyText copyKey="account.referrals.ReferralsClient.3110e898" /></label>
            <div className="flex items-center gap-2">
              <code className="flex-1 min-w-0 truncate text-sm bg-[var(--surface-muted)] rounded-lg px-3 py-2">{link}</code>
              <button onClick={copy} className="px-3 py-2 text-sm font-medium rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-surface-alt)] whitespace-nowrap">
                {copied ? <BuyerCopyText copyKey="account.referrals.ReferralsClient.3f84f875" /> : <BuyerCopyText copyKey="account.referrals.ReferralsClient.a86e8047" />}
              </button>
            </div>
            <button onClick={share} className="btn btn-primary mt-3 w-full">
              <BuyerCopyText copyKey="account.referrals.ReferralsClient.895ce2c6" /></button>
            <p className="text-xs text-[var(--color-muted)] mt-3">
              <BuyerCopyText copyKey="account.referrals.ReferralsClient.e5665fb9" />{' '}<strong className="font-mono">{code}</strong>
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
              <h2 className="font-semibold mb-2"><BuyerCopyText copyKey="account.referrals.ReferralsClient.0d142b0c" /></h2>
              <ul className="space-y-2">
                {stats.credits.map((c) => (
                  <li key={c.code} className="flex items-center justify-between gap-3 border border-[var(--color-border)] rounded-xl px-4 py-3">
                    <span className="min-w-0">
                      <span className="font-mono font-semibold tracking-wide">{c.code}</span>
                      {c.amount_cents != null && <span className="text-sm text-[var(--color-muted)]"> · {formatters.currency(c.amount_cents, 'MXN', { maximumFractionDigits: 0 })} <BuyerCopyText copyKey="account.referrals.ReferralsClient.0c39e9af" /></span>}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-[var(--color-muted)] mt-3">
                <BuyerCopyText copyKey="account.referrals.ReferralsClient.594bff46" />{' '}<Link href="/account/print-ads" className="underline"><BuyerCopyText copyKey="account.referrals.ReferralsClient.9a749d4d" /></Link><BuyerCopyText copyKey="account.referrals.ReferralsClient.c428734c" /></p>
            </div>
          )}
        </>
      ) : (
        <div className="border border-[var(--color-border)] rounded-xl p-5 text-sm text-[var(--color-muted)]">
          <BuyerCopyText copyKey="account.referrals.ReferralsClient.fdcf1343" /></div>
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
