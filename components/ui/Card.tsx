/**
 * Card — seller-portal-rails-foundation S1 · Story 1.1 (R3, radii-by-role).
 * `tile` = list rows/cards (`--r-md`) · `panel` = panels/modals/sheets (`--r-lg`).
 * Wraps the existing `.card-tile`/`.card-panel` classes in `globals.css`.
 */

type CardVariant = 'tile' | 'panel'

const VARIANT_CLASS: Record<CardVariant, string> = {
  tile: 'card-tile',
  panel: 'card-panel',
}

export function Card({
  variant = 'tile',
  className = '',
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  variant?: CardVariant
}) {
  return <div className={`${VARIANT_CLASS[variant]} ${className}`.trim()} {...props} />
}
