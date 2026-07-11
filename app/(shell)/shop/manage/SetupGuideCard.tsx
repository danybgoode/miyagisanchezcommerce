import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { StatusBadge } from '@/components/ui/StatusBadge'
import type { SetupStep } from '@/lib/setup-guide'

/**
 * "Pon tu tienda en marcha" — seller-portal-setup-guide epic, B.2. Reads the
 * 5-step guide computed server-side by `getSetupSteps` (lib/setup-guide.ts);
 * payments is named up front (step 3, "~4 min") rather than sprung on the
 * merchant after the rest looks done. One step "open" (expanded body + CTA)
 * at a time; completed steps collapse with a strikethrough label.
 *
 * Renders nothing once every step is done — B.3 replaces this with the
 * dismiss/restore flow (`guide_dismissed` in shop metadata).
 */
export default function SetupGuideCard({ steps }: { steps: SetupStep[] }) {
  const doneCount = steps.filter((step) => step.done).length
  if (doneCount === steps.length) return null

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
                <Link href={step.ctaHref} className="btn btn-primary btn-sm no-underline">
                  {step.ctaLabel}
                </Link>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}
