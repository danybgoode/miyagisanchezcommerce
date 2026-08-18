'use client'

import { useState } from 'react'
import WallEntryCard from './WallEntryCard'
import { visibleEntries } from '@/lib/wall/feed'
import type { WallCardContext } from './WallCopy'
import type { PublicWallEntry } from '@/lib/wall/types'

/**
 * Living Shop — "see more posts" (epic 07, Stories 2.1 + 7.4).
 *
 * Fetches exactly the NEXT page and appends it. The initial page stays
 * server-rendered — this only exists for the visitor who asks for more, so a
 * merchant's whole history is never a first-paint cost.
 *
 * `offset` advances by what the SERVER returned, not by what is on screen: an
 * entry dropped for an unavailable reference still occupies a position in the
 * ordered Wall, and advancing by the visible count instead would silently skip
 * the entry after it.
 *
 * The slug is passed rather than read from the URL because on an owned host the
 * URL has no slug — and the route ignores it there anyway, resolving the shop
 * from the channel header instead.
 */

export default function WallLoadMore({
  shopSlug,
  initialOffset,
  ctx,
}: {
  shopSlug: string
  initialOffset: number
  ctx: WallCardContext
}) {
  const [entries, setEntries] = useState<PublicWallEntry[]>([])
  const [offset, setOffset] = useState(initialOffset)
  const [hasMore, setHasMore] = useState(true)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  async function loadMore() {
    setBusy(true)
    setFailed(false)
    try {
      const res = await fetch(`/api/shop/wall?slug=${encodeURIComponent(shopSlug)}&offset=${offset}`)
      if (!res.ok) { setFailed(true); return }
      const data = await res.json() as { entries: PublicWallEntry[]; hasMore: boolean }
      setEntries((prev) => [...prev, ...data.entries])
      setOffset((prev) => prev + data.entries.length)
      setHasMore(data.hasMore)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {entries.length > 0 && (
        <div className="flex flex-col gap-3 mt-3">
          {visibleEntries(entries).map((entry) => (
            <WallEntryCard key={entry.id} entry={entry} ctx={ctx} />
          ))}
        </div>
      )}
      {failed && <p role="alert" className="text-sm text-red-600 mt-3">{ctx.copy['wall.loadMoreFailed']}</p>}
      {hasMore && (
        <div className="text-center mt-4">
          <button
            type="button"
            onClick={loadMore}
            disabled={busy}
            className="px-4 py-2 rounded-lg border border-[var(--color-border)] text-sm font-medium"
          >
            {busy ? ctx.copy['wall.loadMoreBusy'] : ctx.copy['wall.loadMore']}
          </button>
        </div>
      )}
    </>
  )
}
