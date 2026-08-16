/**
 * Button — seller-portal-rails-foundation S1 · Story 1.1 (R2).
 * The ONE button hierarchy: `primary` (accent pill, at most one per view) ·
 * `secondary` (alternatives) · `ghost` (tertiary) · `danger` (filled, confirmation
 * surfaces only). Wraps the existing `.btn*` classes in `globals.css` — no
 * hand-rolled `bg-[var(--color-accent)]` shapes.
 */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
}

export function Button({
  variant = 'secondary',
  size,
  loading = false,
  className = '',
  children,
  disabled,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: 'sm' | 'lg'
  /**
   * The action this button started has not finished yet.
   *
   * Three things happen together and none of them is optional:
   *  - `aria-busy` so a screen reader is told the same thing the dot says;
   *  - `disabled`, because the commonest reason a form is submitted twice is
   *    that nothing changed after the first click, so the user clicked again;
   *  - the pending dot, so the *reason* it went inert is visible rather than
   *    reading as a button that broke.
   *
   * `disabled` is deliberately NOT the same prop: a disabled button is one the
   * user may not press, a loading button is one they already pressed.
   */
  loading?: boolean
}) {
  const sizeClass = size === 'sm' ? 'btn-sm' : size === 'lg' ? 'btn-lg' : ''
  return (
    <button
      className={`btn ${VARIANT_CLASS[variant]} ${sizeClass} ${className}`.trim()}
      // A loading button must not be pressable again, but an explicitly
      // `disabled` one stays disabled for its own reasons.
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-pending={loading ? 'true' : undefined}
      {...props}
    >
      {children}
      {loading ? <span className="pending-dot" data-testid="pending-dot" aria-hidden /> : null}
    </button>
  )
}
