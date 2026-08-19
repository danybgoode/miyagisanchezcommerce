import ShopHeader from '@/app/(shell)/_shop-chrome/ShopHeader'
import type { SectionConfig, SectionAvailability, SectionKey } from '@/lib/shop-presentation/types'
import type { Dictionary } from '@/lib/dictionary'

/**
 * Living Shop — the shop nav, now the FULL header (epic 07, Sprint 8 follow-up).
 *
 * Sprint 8 gave the homepage a sticky header carrying identity + navigation, but
 * left every OTHER shop surface — /tienda, /colecciones, /eventos, the content
 * pages, the collection pages — on the old bare chip strip. Reported live:
 * "going to /tienda changes the layout and the navbar moves to the top left."
 * That is one shop rendering two different chromes depending on which link you
 * followed, which is precisely what Story 3.2 set out to prevent.
 *
 * Rather than edit seven call sites into a new component, this one keeps its
 * name and props and renders the header. The seven surfaces converge by
 * construction, and a future surface that imports the "nav" gets the header too.
 *
 * `shopName` / `logoUrl` are optional so the older call sites compile unchanged;
 * without a name there is no identity to show and it degrades to links only.
 */
export default function ShopSectionNav({
  config,
  availability,
  basePath,
  active,
  accent,
  activeTextColor,
  copy,
  shopName,
  logoUrl,
}: {
  config: SectionConfig
  availability: SectionAvailability
  basePath: string
  active: SectionKey | null
  accent: string
  activeTextColor: string
  copy: Dictionary['buyerCopy']
  shopName?: string
  logoUrl?: string | null
}) {
  return (
    <ShopHeader
      shopName={shopName ?? ''}
      logoUrl={logoUrl ?? null}
      config={config}
      availability={availability}
      basePath={basePath}
      active={active}
      accent={accent}
      accentTextColor={activeTextColor}
      copy={copy}
    />
  )
}
