import type { ResolvedTheme } from '@/lib/shop-presentation/types'

/**
 * Living Shop — the theme wrapper every shop surface shares (epic 07, Story 4.5).
 *
 * ONE place emits the theme attributes and variables, so the Wall, the catalog,
 * a collection, an event list and a content page all inherit the merchant's
 * identity without each one re-deriving it. A per-surface copy is how a shop
 * ends up looking like two different shops depending on which link you followed.
 *
 * Everything here is GENERATED: the attributes come from closed enums and the
 * variables from validated values (`lib/shop-presentation/theme.ts`). No seller
 * string is interpolated into markup, which is what makes Custom mode safe
 * without an allow-list of HTML.
 *
 * The platform's secure hops — checkout and auth — are deliberately OUTSIDE this
 * wrapper. A payment page that adopted the merchant's colours would be a page a
 * buyer could not tell apart from a merchant-controlled one, and that trade is
 * not the merchant's to make.
 */
export default function ShopThemeShell({
  theme,
  accent,
  children,
}: {
  theme: ResolvedTheme
  /** The shop's existing accent, kept as the base so a recipe without one inherits it. */
  accent: string
  children: React.ReactNode
}) {
  return (
    <div
      style={{ '--shop-accent': accent, ...theme.variables } as React.CSSProperties}
      data-shop-theme={theme.attribute}
      data-shop-surface={theme.recipe.surface}
      data-shop-background={theme.recipe.background}
      data-shop-wall={theme.recipe.wall_layout}
      data-shop-identity={theme.recipe.identity}
      data-shop-preset={theme.presetAttribute || undefined}
    >
      {children}
    </div>
  )
}
