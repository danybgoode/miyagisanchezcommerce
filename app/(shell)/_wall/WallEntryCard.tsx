'use client'

/* eslint-disable @next/next/no-img-element -- Wall media and product thumbnails are seller-hosted on R2 / arbitrary remote domains, outside the Next Image allow-list. */

import Link from 'next/link'
import { formatWallDate, collectionCountLabel, type WallCardContext } from './WallCopy'
import WallPostBody from './WallPostBody'
import { shopInitials, relativeDay } from '@/lib/shop-presentation/chrome'
import type { PublicWallEntry, WallKind } from '@/lib/wall/types'

/**
 * Living Shop — one Wall card (epic 07, Stories 2.2–2.4).
 *
 * The buyer never has to decode whether an entry is "social" or "commerce": the
 * affordance is the object itself, so a product card carries a real price and a
 * real link to the existing PDP, and an event card carries the real RSVP
 * destination.
 *
 * It is a CLIENT component for one reason: `WallLoadMore` appends fetched entries
 * with the same component, and a client parent cannot render a server child. The
 * first page is still server-RENDERED (client components SSR), so the Wall is in
 * the HTML for a crawler and for a visitor with no JavaScript — only the
 * expand/collapse and the load-more button need hydration.
 *
 * There is no comment, reaction or share UI, by scope.
 *
 * An `unavailable` reference renders NOTHING — the caller drops it before we get
 * here. That is the one documented rule for a dead reference (S7.5): it
 * disappears rather than becoming broken chrome or a stale buyable price.
 */

const KIND_LABEL: Record<WallKind, 'wall.kindPost' | 'wall.kindProduct' | 'wall.kindCollection' | 'wall.kindEvent'> = {
  post: 'wall.kindPost',
  product: 'wall.kindProduct',
  collection: 'wall.kindCollection',
  event: 'wall.kindEvent',
}

export default function WallEntryCard({ entry, ctx }: { entry: PublicWallEntry; ctx: WallCardContext }) {
  const { copy, htmlLang } = ctx

  /**
   * "Hoy · Nota de la tienda" rather than a bare date (Story 8.3). The relative
   * part is derived from calendar days, and the STRING comes from the
   * dictionary — assembling "Hace 3 días" here would hardcode Spanish into a
   * surface that renders in two languages.
   */
  const rel = relativeDay(entry.effective_at, ctx.now)
  const when = rel.kind === 'today' ? copy['wall.today']
    : rel.kind === 'yesterday' ? copy['wall.yesterday']
    : rel.kind === 'days' ? copy['wall.daysAgo'].replace('{0}', String(rel.days))
    : formatWallDate(entry.effective_at, htmlLang)

  return (
    <article className="wall-card" data-label={copy[KIND_LABEL[entry.kind]]}>
      <header className="wall-posthead">
        {ctx.shopLogoUrl ? (
          <img src={ctx.shopLogoUrl} alt="" className="wall-miniavatar" />
        ) : (
          <span className="wall-miniavatar wall-miniavatar-fallback" aria-hidden>{shopInitials(ctx.shopName)}</span>
        )}
        <span className="wall-postmeta">
          <strong>{ctx.shopName}</strong>
          <time dateTime={entry.effective_at}>{when} · {copy[KIND_LABEL[entry.kind]]}</time>
        </span>
        {entry.pinned && (
          <span className="wall-pin">
            <i className="iconoir-pin" aria-hidden /> {copy['wall.pinned']}
          </span>
        )}
      </header>

      {entry.body && (
        <div className="px-4 pt-2">
          <WallPostBody body={entry.body} more={copy['wall.readMore']} less={copy['wall.readLess']} />
        </div>
      )}

      {entry.kind === 'post' && entry.media.length > 0 && (
        <ul className={`mt-3 grid gap-1 list-none p-0 m-0 ${entry.media.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {entry.media.map((m) => (
            <li key={m.url}>
              {/* `alt` is the seller's own description; an empty string is a
                  deliberate "decorative", which is the correct value for a photo
                  the body already describes — never a missing attribute. */}
              <img
                src={m.url}
                alt={m.alt}
                loading="lazy"
                decoding="async"
                className="w-full h-auto max-h-[28rem] object-cover"
              />
            </li>
          ))}
        </ul>
      )}

      {entry.reference.state === 'product' && (
        <Link
          href={entry.reference.product.href}
          className="mt-3 flex gap-3 items-center px-4 pb-4 no-underline text-[var(--color-text)] hover:opacity-90"
        >
          {entry.reference.product.imageUrl ? (
            <img
              src={entry.reference.product.imageUrl}
              alt=""
              loading="lazy"
              decoding="async"
              className="w-20 h-20 rounded-lg object-cover flex-shrink-0"
            />
          ) : (
            <div className="w-20 h-20 rounded-lg bg-[var(--color-surface-alt)] flex items-center justify-center flex-shrink-0">
              <i className="iconoir-package" aria-hidden />
            </div>
          )}
          <div className="min-w-0">
            <p className="font-medium text-sm leading-snug line-clamp-2">{entry.reference.product.title}</p>
            {entry.reference.product.formattedPrice && (
              <p className="text-base font-bold mt-0.5" style={{ color: 'var(--shop-accent)' }}>
                {entry.reference.product.formattedPrice}
              </p>
            )}
            <p className="text-xs text-[var(--color-muted)] mt-0.5">
              {entry.reference.product.available ? copy['wall.productCta'] : copy['wall.productSoldOut']}
            </p>
          </div>
        </Link>
      )}

      {entry.reference.state === 'collection' && (
        <div className="mt-3 px-4 pb-4">
          <Link href={entry.reference.collection.href} className="no-underline text-[var(--color-text)]">
            <p className="font-medium text-sm">{entry.reference.collection.name}</p>
            <p className="text-xs text-[var(--color-muted)]">
              {collectionCountLabel(copy, entry.reference.collection.productCount)}
            </p>
          </Link>
          <ul className="grid grid-cols-4 gap-1.5 mt-2 list-none p-0 m-0">
            {entry.reference.collection.sample.map((p) => (
              <li key={p.id}>
                <Link href={p.href} className="no-underline block">
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt={p.title} loading="lazy" decoding="async" className="w-full aspect-square rounded-lg object-cover" />
                  ) : (
                    <div className="w-full aspect-square rounded-lg bg-[var(--color-surface-alt)]" />
                  )}
                </Link>
              </li>
            ))}
          </ul>
          <Link href={entry.reference.collection.href} className="inline-block mt-2 text-sm font-medium" style={{ color: 'var(--shop-accent)' }}>
            {copy['wall.collectionCta']}
          </Link>
        </div>
      )}

      {entry.reference.state === 'event' && (
        <div className="mt-3 px-4 pb-4">
          <p className="font-medium text-sm">{entry.reference.event.title}</p>
          <p className="text-xs text-[var(--color-muted)] mt-0.5">
            <i className="iconoir-calendar" aria-hidden /> {formatWallDate(entry.reference.event.startsAt, htmlLang)}
            {' · '}
            {entry.reference.event.venueName}
          </p>
          {/* Cancelled and past are DEFINED states, not a missing card: a visitor
              who heard about the event needs to learn it is off, and silently
              hiding it would send them looking. */}
          {entry.reference.event.cancelled ? (
            <p className="text-xs font-medium text-red-600 mt-1">{copy['wall.eventCancelled']}</p>
          ) : entry.reference.event.past ? (
            <p className="text-xs text-[var(--color-muted)] mt-1">{copy['wall.eventPast']}</p>
          ) : (
            <Link href={entry.reference.event.href} className="inline-block mt-2 text-sm font-medium" style={{ color: 'var(--shop-accent)' }}>
              {copy['wall.eventCta']}
            </Link>
          )}
        </div>
      )}

      {/* A post with no body, no media and no reference cannot exist — the table
          forbids it — so there is no empty-card branch to render. */}
      {entry.kind === 'post' && entry.media.length === 0 && !entry.body && null}
    </article>
  )
}
