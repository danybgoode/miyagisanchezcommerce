'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { useSettingsSave } from './settings/_components/useSettingsSave'
import { pushAnalyticsEvent } from '@/lib/analytics-events'
import { pushGrowthEvent } from '@/lib/growth-events'
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
  const { save } = useSettingsSave()
  const [dismissed, setDismissed] = useState(initialDismissed)

  const doneCount = steps.filter((step) => step.done).length
  const allDone = doneCount === steps.length
  const visible = !dismissed && !allDone
  const openStep = steps.find((step) => step.open)

  // guide_view — once per mount while the card is actually on screen. Also forwarded
  // to the golden-beans Growth Engine (Story 1.3) — the internal route no-ops when
  // growth.telemetry_enabled is OFF, so this call is always safe to make.
  useEffect(() => {
    if (visible) {
      pushAnalyticsEvent('guide_view')
      pushGrowthEvent('setup_guide_viewed', { featureId: 'setup_guide' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // guide_step_open — once per distinct step becoming the open one (not on
  // every re-render of the same open step).
  const lastOpenId = useRef<string | null>(null)
  useEffect(() => {
    if (!visible || !openStep || openStep.id === lastOpenId.current) return
    lastOpenId.current = openStep.id
    pushAnalyticsEvent('guide_step_open', { step_id: openStep.id })
  }, [visible, openStep])

  // guide_step_complete — fires once per step, per browser, the first time it
  // renders done (router.refresh() after a mutation re-triggers this render).
  // Known trade-off: a seller who configured payments/profile BEFORE this
  // feature shipped will fire a one-time "complete" event on their first
  // post-deploy dashboard load — indistinguishable from a guide-driven
  // completion. A per-mount baseline would filter that out, but payments
  // completes via an external OAuth redirect (a full page load, not a
  // same-mount router.refresh()), so a baseline would just as often swallow
  // the real signal the epic cares about most. Left as a bounded, one-time
  // data-quality footnote rather than trading a bigger problem for a smaller
  // one — noted in sprint-1.md.
  useEffect(() => {
    for (const step of steps) {
      if (!step.done) continue
      pushAnalyticsEvent(
        'guide_step_complete',
        { step_id: step.id },
        { dedupeKey: `guide_step_complete_${shopSlug}_${step.id}` },
      )
      pushGrowthEvent(
        'setup_guide_step_completed',
        { featureId: 'setup_guide', tags: { step_id: step.id } },
        { dedupeKey: `setup_guide_step_completed_${shopSlug}_${step.id}` },
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps])

  const handleDismiss = useCallback(async () => {
    setDismissed(true) // optimistic — the card should disappear immediately
    const ok = await save({ settings: { guide: { guide_dismissed: true } } })
    if (!ok) setDismissed(false)
    else pushAnalyticsEvent('guide_dismiss')
  }, [save])

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
                <StatusBadge token="success" className="flex-shrink-0"><i className="iconoir-check" aria-hidden /></StatusBadge>
              ) : step.open && step.estimate ? (
                <StatusBadge token="neutral" className="flex-shrink-0">{step.estimate}</StatusBadge>
              ) : null}
            </div>

            {step.open && !step.done && (
              <div className="mt-2">
                <p className="text-xs text-[var(--color-muted)] mb-2 leading-relaxed">{step.body}</p>
                <Link href={step.ctaHref} className="btn btn-primary btn-sm no-underline">
                  {step.ctaLabel}
                </Link>
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
