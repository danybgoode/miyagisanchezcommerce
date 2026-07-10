/**
 * Banner — seller-portal-rails-foundation S1 · Story 1.2 (R6 "before"/persistent
 * callouts). The ONE banner primitive — only `components/feedback/` may render
 * one (rail R6). For persistent, non-auto-dismiss messages (bulk-action
 * results, form submit errors) — use `<Toast>` for ephemeral after-states.
 */

export type BannerVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

const ICON: Record<BannerVariant, string> = {
  success: 'iconoir-check-circle',
  warning: 'iconoir-warning-triangle',
  danger: 'iconoir-warning-triangle',
  info: 'iconoir-info-circle',
  neutral: 'iconoir-info-circle',
}

const TEXT_VAR: Record<BannerVariant, string> = {
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  info: 'var(--info)',
  neutral: 'var(--neutral)',
}

const BG_VAR: Record<BannerVariant, string> = {
  success: 'var(--success-soft)',
  warning: 'var(--warning-soft)',
  danger: 'var(--danger-soft)',
  info: 'var(--info-soft)',
  neutral: 'var(--neutral-soft)',
}

export function Banner({
  variant = 'info',
  title,
  children,
  action,
  className = '',
}: {
  variant?: BannerVariant
  title?: string
  children: React.ReactNode
  action?: { label: string; onClick: () => void }
  className?: string
}) {
  const isAlert = variant === 'danger' || variant === 'warning'
  return (
    <div
      role={isAlert ? 'alert' : 'status'}
      className={`flex items-start gap-2.5 rounded-[var(--r-lg)] border border-[var(--border)] px-4 py-3 text-sm ${className}`.trim()}
      style={{ background: BG_VAR[variant] }}
    >
      <i className={`${ICON[variant]} mt-0.5 shrink-0`} aria-hidden="true" style={{ color: TEXT_VAR[variant] }} />
      <div className="flex-1 min-w-0">
        {title && (
          <p className="font-medium" style={{ color: TEXT_VAR[variant] }}>
            {title}
          </p>
        )}
        <div className={title ? 'mt-0.5 text-[var(--fg)]' : 'text-[var(--fg)]'}>{children}</div>
      </div>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="font-semibold underline underline-offset-2 shrink-0"
          style={{ color: TEXT_VAR[variant] }}
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
