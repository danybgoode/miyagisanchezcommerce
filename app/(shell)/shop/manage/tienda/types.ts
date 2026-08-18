/**
 * Living Shop — the studio's client-prop shapes (epic 07).
 *
 * Type-only. Kept out of the components so the server page, the tabs and the
 * composer all read ONE declaration — the same reason `lib/shop-settings/types.ts`
 * exists.
 */

import type { WallEntry } from '@/lib/wall/types'

export interface StudioProduct {
  id: string
  title: string
  imageUrl: string | null
}

export interface StudioCollection {
  handle: string
  name: string
}

export interface StudioEvent {
  slug: string
  title: string
  startsAt: string
  cancelled: boolean
}

export interface StudioObjects {
  products: StudioProduct[]
  collections: StudioCollection[]
  events: StudioEvent[]
}

export interface StudioShop {
  slug: string
  name: string
}

export type StudioTab = 'wall' | 'sections' | 'theme' | 'brand' | 'preview'

export interface WallTabProps {
  objects: StudioObjects
  initialEntries: WallEntry[]
}
