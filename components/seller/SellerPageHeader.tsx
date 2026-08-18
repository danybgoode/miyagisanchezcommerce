import type { ReactNode } from 'react'

/**
 * The seller portal's page header: a title, optional supporting lines, and the
 * page's actions.
 *
 * WHY THIS EXISTS. Every hub page had authored the same `flex items-start
 * justify-between` row by hand, with the action cluster marked `flex-shrink-0`.
 * On a desktop that reads fine. On a 375px phone the two buttons hold their full
 * width and the title is what gives — a shop called "Panadería La Esperanza"
 * collapsed into a 60px column and wrapped one word per line. The fix is not a
 * narrower button; it is that below `sm` a title and its actions are not on the
 * same axis at all.
 *
 * The rules this encodes, so no page has to remember them:
 *   · below `sm` the header is a COLUMN — the title gets the full width and the
 *     actions sit underneath as full-width, thumb-sized targets;
 *   · from `sm` up it is the familiar row, actions right, and only then may the
 *     action cluster refuse to shrink;
 *   · the title always sits in a `min-w-0` cell, because a flex child defaults to
 *     `min-width: auto` and will push its siblings off the row rather than wrap.
 */
export default function SellerPageHeader({
  title,
  meta,
  actions,
  className = '',
}: {
  title: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={`flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-6 sm:mb-8 ${className}`}>
      <div className="min-w-0">
        {typeof title === 'string'
          ? <h1 className="text-xl sm:text-2xl font-bold leading-tight break-words">{title}</h1>
          : title}
        {meta ? <div className="mt-2 flex flex-col gap-1">{meta}</div> : null}
      </div>
      {actions ? <SellerHeaderActions>{actions}</SellerHeaderActions> : null}
    </div>
  )
}

/**
 * The action cluster on its own, for a header that cannot use the component
 * above (a client page whose title is already a custom node, say).
 *
 * `[&>*]:flex-1` is what makes the buttons share the row evenly on a phone
 * without every call site having to add a width class to each child; from `sm`
 * up they revert to their natural width. `min-h-11` is the 44px touch target.
 */
export function SellerHeaderActions({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 w-full sm:w-auto sm:flex-shrink-0 [&>*]:flex-1 sm:[&>*]:flex-none [&_.btn]:min-h-11 [&_.btn]:justify-center">
      {children}
    </div>
  )
}

/**
 * A horizontally scrollable shell for a wide table.
 *
 * The page body must never scroll sideways, so the table scrolls inside its own
 * box instead. `-mx-4 px-4` lets the scroll area run to the edge of a phone
 * screen while the content keeps the page gutter, so a row does not look clipped.
 */
export function SellerTableScroll({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
      {children}
    </div>
  )
}
