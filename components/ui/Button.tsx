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
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: 'sm' | 'lg'
}) {
  const sizeClass = size === 'sm' ? 'btn-sm' : size === 'lg' ? 'btn-lg' : ''
  return <button className={`btn ${VARIANT_CLASS[variant]} ${sizeClass} ${className}`.trim()} {...props} />
}
