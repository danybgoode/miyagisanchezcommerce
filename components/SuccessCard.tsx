'use client'

import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Banner } from '@/components/feedback/Banner'
import { Toast, useToast } from '@/components/feedback/Toast'

/**
 * SuccessCard — onboarding three-doors Sprint 2 · Story 2.2 (S5 + F12).
 *
 * One shared "done" screen so SellWizard's StepSuccess, SetupClient's
 * SetupReport, and ImportClient's report all converge on the same layout,
 * next-step logic, and share affordance (audit finding F12) instead of three
 * independently hand-rolled endings.
 */

export interface SuccessCardNextAction {
  label: string
  href?: string
  onClick?: () => void
}

export interface SuccessCardProps {
  headline: string
  subcopy: string
  counts?: { created: number; updated: number; failed: number; draft: number }
  liveUrl: string
  liveLabel?: string
  warningCallout?: {
    text: string
    primaryAction: { label: string; href: string }
    ghostAction: { label: string; href: string }
  }
  /** Rendered up to the first 2 — callers don't need to slice themselves. */
  nextActions: SuccessCardNextAction[]
  shareUrl: string
  shareTitle?: string
}

function buildWhatsAppShareLink(shareTitle: string, shareUrl: string): string {
  const message = `${shareTitle}: ${shareUrl}`
  return `https://wa.me/?text=${encodeURIComponent(message)}`
}

export function SuccessCard({
  headline,
  subcopy,
  counts,
  liveUrl,
  liveLabel = 'Ver mi tienda pública ↗',
  warningCallout,
  nextActions,
  shareUrl,
  shareTitle = 'Mi tienda en Miyagi Sánchez',
}: SuccessCardProps) {
  const { toast, showToast, dismissToast } = useToast()
  const actions = nextActions.slice(0, 2)

  // Generic share fallback (ported from SetupGuideCard.tsx's handleShare) —
  // native share sheet first, clipboard fallback, cancel isn't a failure.
  async function handleGenericShare() {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: shareTitle, url: shareUrl })
        return
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return
        // fall through to clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl)
      showToast('Enlace copiado', 'success')
    } catch {
      showToast('No se pudo copiar el enlace', 'error')
    }
  }

  return (
    <Card variant="panel" data-testid="success-card" className="p-5 text-center">
      <div className="inline-flex items-center justify-center w-16 h-16 bg-[var(--success-soft)] rounded-[var(--r-pill)] mb-4">
        <span className="text-3xl">✅</span>
      </div>
      <h2 className="text-xl font-bold">{headline}</h2>
      <p className="text-sm text-[var(--color-muted)] mt-1">{subcopy}</p>

      {counts && (
        <div className="flex flex-wrap items-center justify-center gap-3 mt-4">
          {counts.created > 0 && <StatusBadge token="success">✓ {counts.created} creados</StatusBadge>}
          {counts.updated > 0 && <StatusBadge token="warning">↻ {counts.updated} actualizados</StatusBadge>}
          {counts.draft > 0 && <StatusBadge token="neutral">📝 {counts.draft} borrador(es)</StatusBadge>}
          {counts.failed > 0 && <StatusBadge token="danger">✕ {counts.failed} fallaron</StatusBadge>}
        </div>
      )}

      {liveUrl && (
        <p className="mt-4">
          <Link href={liveUrl} className="text-[var(--color-accent)] font-semibold hover:underline">
            {liveLabel}
          </Link>
        </p>
      )}

      {warningCallout && (
        <div className="mt-4 text-left">
          <Banner
            variant="warning"
            action={{
              label: warningCallout.primaryAction.label,
              onClick: () => { window.location.href = warningCallout.primaryAction.href },
            }}
          >
            {warningCallout.text}
          </Banner>
          <p className="text-right mt-1.5">
            <Link href={warningCallout.ghostAction.href} className="text-xs text-[var(--color-muted)] hover:underline">
              {warningCallout.ghostAction.label}
            </Link>
          </p>
        </div>
      )}

      {actions.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-3 mt-6">
          {actions.map((action, i) => {
            const variant = i === 0 ? 'primary' : 'secondary'
            if (action.href) {
              return (
                <Link key={action.label} href={action.href} className={`btn btn-${variant} flex-1 text-center no-underline`}>
                  {action.label}
                </Link>
              )
            }
            return (
              <Button key={action.label} type="button" variant={variant} className="flex-1" onClick={action.onClick}>
                {action.label}
              </Button>
            )
          })}
        </div>
      )}

      {shareUrl && (
        <div className="flex flex-wrap items-center justify-center gap-3 mt-5 pt-5 border-t border-[var(--color-border)]">
          <a
            href={buildWhatsAppShareLink(shareTitle, shareUrl)}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            Compartir por WhatsApp
          </a>
          <Button type="button" variant="ghost" size="sm" onClick={handleGenericShare}>
            Compartir enlace
          </Button>
        </div>
      )}

      <Toast toast={toast} onDismiss={dismissToast} />
    </Card>
  )
}

export function SuccessCardProgress({
  done,
  total,
  caption = 'Esto puede tardar unos segundos…',
}: {
  done: number
  total: number
  caption?: string
}) {
  return (
    <Card variant="panel" data-testid="success-card-progress" className="p-5 text-center">
      <div
        className="inline-block w-8 h-8 rounded-[var(--r-pill)] border-2 border-[var(--color-accent)] border-t-transparent animate-spin mb-3"
        aria-hidden="true"
      />
      <p className="font-semibold">Creando tu catálogo… {done} de {total}</p>
      <div className="h-2 rounded-[var(--r-pill)] bg-[var(--color-border)] overflow-hidden mt-3 max-w-xs mx-auto">
        <div
          className="h-full bg-[var(--color-accent)] transition-all"
          style={{ width: `${total ? (done / total) * 100 : 0}%` }}
        />
      </div>
      <p className="text-xs text-[var(--color-muted)] mt-3">{caption}</p>
    </Card>
  )
}
