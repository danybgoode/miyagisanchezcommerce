import type { ActiveDeal } from '@/lib/active-deal'

export type BuyerPrefill = { name: string; email: string }

export type PdpViewerState = {
  signedIn: boolean
  ownsListing: boolean
  favorited: boolean
  activeDeal: ActiveDeal | null
  buyerPrefill: BuyerPrefill | null
}

export const SIGNED_OUT_PDP_VIEWER_STATE: PdpViewerState = {
  signedIn: false,
  ownsListing: false,
  favorited: false,
  activeDeal: null,
  buyerPrefill: null,
}
