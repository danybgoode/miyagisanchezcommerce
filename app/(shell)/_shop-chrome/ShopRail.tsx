import Link from 'next/link'
import { trustChips, hasShopStatus, type ShopStatus } from '@/lib/shop-presentation/chrome'
import type { Dictionary } from '@/lib/dictionary'

/**
 * Living Shop — the supporting rail (epic 07, Story 8.4).
 *
 * 🚨 THIS CLOSES A REAL DEFECT, not just a visual gap. Sprint 4's `feed-sidebar`
 * recipe turned the Wall container into a two-column grid whose only children
 * were the post cards — so at desktop width Retro tiled cards into two columns
 * and nothing filled the second track, because the rail the recipe promised was
 * never built. This is that sibling.
 *
 * Every panel is REAL DATA OR ABSENT. The concept shows "Usually ships in 2–4
 * days" and a next market date; a shop that configured neither gets neither,
 * because inventing them would put a promise on a merchant's storefront that
 * they never made and cannot keep.
 */

export interface RailCollection {
  handle: string
  name: string
  href: string
  count: number
  thumbUrl: string | null
}

export interface RailContact {
  href: string
  label: string
}

export default function ShopRail({
  about,
  chips,
  collections,
  status,
  contacts,
  claimHref,
  copy,
}: {
  about: string | null
  chips: ReturnType<typeof trustChips>
  collections: RailCollection[]
  status: ShopStatus
  /**
   * The shop's own contact affordances — WhatsApp, phone, email, socials.
   *
   * They lived in the old identity header this sprint replaced. Moving them here
   * rather than dropping them: an unclaimed shop's only way to be reached, and a
   * merchant's socials, are not decoration. The linter caught them going
   * unreferenced, which is exactly the kind of silent feature loss a big visual
   * refactor causes.
   */
  contacts: RailContact[]
  /** Present only for an UNCLAIMED shop — the "this is my shop" path. */
  claimHref: string | null
  copy: Dictionary['buyerCopy']
}) {
  const showAbout = !!about || chips.length > 0 || contacts.length > 0 || !!claimHref
  const showCollections = collections.length > 0
  const showStatus = hasShopStatus(status)
  if (!showAbout && !showCollections && !showStatus) return null

  const chipLabel = { verified: 'panels.verified', ships: 'panels.shipsNationwide', pickup: 'panels.localPickup' } as const

  return (
    <aside className="shop-rail">
      {showAbout && (
        <section className="shop-panel" data-label={copy['panels.labelProfile']}>
          <h2 className="shop-panel-title">{copy['panels.aboutTitle']}</h2>
          {about && <p className="shop-panel-text">{about}</p>}
          {chips.length > 0 && (
            <ul className="shop-chips">
              {chips.map((chip) => (
                <li key={chip.key} className="shop-chip">{copy[chipLabel[chip.key]]}</li>
              ))}
            </ul>
          )}
          {contacts.length > 0 && (
            <ul className="shop-chips">
              {contacts.map((contact) => (
                <li key={contact.href}>
                  <a href={contact.href} className="shop-chip" target="_blank" rel="noopener noreferrer">
                    {contact.label}
                  </a>
                </li>
              ))}
            </ul>
          )}
          {claimHref && (
            <Link href={claimHref} className="shop-chip shop-chip-claim">{copy['s.slug.page.ef1e1e62']}</Link>
          )}
        </section>
      )}

      {showCollections && (
        <section className="shop-panel" data-label={copy['panels.labelCollections']}>
          <h2 className="shop-panel-title">{copy['panels.collectionsTitle']}</h2>
          <ul className="shop-collection-list">
            {collections.map((collection) => (
              <li key={collection.handle}>
                <Link href={collection.href} className="shop-collection">
                  {collection.thumbUrl
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={collection.thumbUrl} alt="" className="shop-collection-thumb" />
                    : <span className="shop-collection-thumb shop-collection-thumb-empty" aria-hidden />}
                  <span className="shop-collection-copy">
                    <strong>{collection.name}</strong>
                    <span>
                      {collection.count === 1
                        ? copy['panels.productCountOne']
                        : copy['panels.productCount'].replace('{0}', String(collection.count))}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {showStatus && (
        <section className="shop-panel" data-label={copy['panels.labelNow']}>
          <h2 className="shop-panel-title">{copy['panels.statusTitle']}</h2>
          <p className="shop-panel-text">
            {status.dispatch && copy['panels.dispatch'].replace('{0}', status.dispatch)}
            {status.dispatch && status.nextEvent && <br />}
            {status.nextEvent && copy['panels.nextEvent'].replace('{0}', status.nextEvent)}
          </p>
        </section>
      )}
    </aside>
  )
}
