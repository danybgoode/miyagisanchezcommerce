'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { useSettingsSave } from './settings/_components/useSettingsSave'
import type { SetupStep } from '@/lib/setup-guide'

/**
 * "Pon tu tienda en marcha" — seller-portal-setup-guide epic, B.2/B.3. Reads
 * the 5-step guide computed server-side by `getSetupSteps` (lib/setup-guide.ts);
 * payments is named up front (step 3, "~4 min") rather than sprung on the
 * merchant after the rest looks done. One step "open" (expanded body + CTA)
 * at a time; completed steps collapse with a strikethrough label.
 *
 * "Ocultar" and the comparte step's share action both persist through the
 * existing PATCH /api/sell/shop seam (`useSettingsSave`, same hook every
 * settings section uses) into `metadata.settings.guide`, then
 * `router.refresh()` so the server recomputes `steps`/`initialDismissed`
 * from the source of truth rather than guessing at an optimistic update.
 *
 * Renders nothing once every step is done, or once dismissed. Fail-safe: an
 * absent/malformed `guide_dismissed` flag reads as `false` (show the guide).
 */
export default function SetupGuideCard({
  steps,
  initialDismissed,
  shopSlug,
}: {
  steps: SetupStep[]
  initialDismissed: boolean
  shopSlug: string
}) {
  const router = useRouter()
  const { save } = useSettingsSave()
  const [dismissed, setDismissed] = useState(initialDismissed)
  const [sharing, setSharing] = useState(false)

  const doneCount = steps.filter((step) => step.done).length
  const allDone = doneCount === steps.length

  const handleDismiss = useCallback(async () => {
    setDismissed(true) // optimistic — the card should disappear immediately
    const ok = await save({ settings: { guide: { guide_dismissed: true } } })
    if (!ok) setDismissed(false)
  }, [save])

  const handleShare = useCallback(async () => {
    setSharing(true)
    try {
      const url = typeof window !== 'undefined' ? `${window.location.origin}/s/${shopSlug}` : ''
      if (url) {
        if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
          try {
            await navigator.share({ title: 'Mi tienda en Miyagi Sánchez', url })
          } catch (err) {
            if ((err as Error)?.name !== 'AbortError') {
              await navigator.clipboard?.writeText(url).catch(() => {})
            }
          }
        } else {
          await navigator.clipboard?.writeText(url).catch(() => {})
        }
      }
      await save({ settings: { guide: { share_done: true } } })
      router.refresh()
    } finally {
      setSharing(false)
    }
  }, [save, shopSlug, router])

  if (dismissed || allDone) return null

  return (
    <Card variant="panel" className="mb-8 p-5">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h2 className="font-bold text-base">Pon tu tienda en marcha</h2>
        <span className="text-xs text-[var(--color-muted)] flex-shrink-0">
          {doneCount} de {steps.length}
        </span>
      </div>
      <div className="h-1.5 bg-[var(--border)] rounded-[var(--r-pill)] overflow-hidden mb-4">
        <div
          className="h-full bg-[var(--accent)] rounded-[var(--r-pill)] transition-[width] duration-500"
          style={{ width: `${(doneCount / steps.length) * 100}%` }}
        />
      </div>

      <ul className="flex flex-col">
        {steps.map((step) => (
          <li key={step.id} className="border-b border-[var(--color-border)] last:border-b-0 py-3 first:pt-0 last:pb-0">
            <div className="flex items-center justify-between gap-3">
              <span
                className={`text-sm font-medium ${
                  step.done ? 'line-through text-[var(--color-muted)]' : 'text-[var(--color-foreground)]'
                }`}
              >
                {step.label}
              </span>
              {step.done ? (
                <StatusBadge token="success" className="flex-shrink-0">✓</StatusBadge>
              ) : step.open && step.estimate ? (
                <StatusBadge token="neutral" className="flex-shrink-0">{step.estimate}</StatusBadge>
              ) : null}
            </div>

            {step.open && !step.done && (
              <div className="mt-2">
                <p className="text-xs text-[var(--color-muted)] mb-2 leading-relaxed">{step.body}</p>
                {step.id === 'comparte' ? (
                  <Button type="button" variant="primary" size="sm" onClick={handleShare} disabled={sharing}>
                    {sharing ? 'Compartiendo…' : step.ctaLabel}
                  </Button>
                ) : (
                  <Link href={step.ctaHref} className="btn btn-primary btn-sm no-underline">
                    {step.ctaLabel}
                  </Link>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      <div className="flex justify-end mt-3 pt-3 border-t border-[var(--color-border)]">
        <Button type="button" variant="ghost" size="sm" onClick={handleDismiss}>
          Ocultar
        </Button>
      </div>
    </Card>
  )
}
