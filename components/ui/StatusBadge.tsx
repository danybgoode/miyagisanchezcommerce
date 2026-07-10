import type { StatusToken } from '@/lib/status-badge'

/**
 * StatusBadge — seller-portal-rails-foundation S1 · Story 1.1 (R1).
 * The ONE status-chip primitive: every state in the seller portal renders
 * through this component so it always speaks one of the 5 semantic tokens
 * (+ `promo` for the ML-source override) — never a raw Tailwind palette class.
 */

const TOKEN_CLASS: Record<StatusToken, string> = {
  success: 'badge-success',
  warning: 'badge-warning',
  danger: 'badge-danger',
  info: 'badge-info',
  neutral: 'badge-neutral',
  promo: 'badge-promo',
}

export function StatusBadge({
  token,
  children,
  className = '',
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  token: StatusToken
  children: React.ReactNode
}) {
  return (
    <span className={`badge ${TOKEN_CLASS[token]} ${className}`.trim()} {...props}>
      {children}
    </span>
  )
}
