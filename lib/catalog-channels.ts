/**
 * Channel-badge deriver — pure, next-free (catalog-management epic, Sprint 2 ·
 * Story 2.2). Turns a listing's `channels` array into the two badges the
 * catalog table shows. Gives the deploy-lag fallback (`channels ?? ['miyagi']`,
 * previously an inline `??` in CatalogTable.tsx) a unit-tested home, and keeps
 * the ML-badge fix (respecting `ml_status`, done backend-side in
 * `sellers/me/products/route.ts`) exercised through one seam.
 */

export interface ChannelBadgeInput {
  channels?: string[]
}

export interface ChannelBadges {
  miyagi: boolean
  ml: boolean
}

/**
 * Deploy-lag safety: backend Cloud Run has no per-branch preview, so a moment
 * can exist where the frontend is live before the backend's `channels` field
 * is — degrade to the always-true Miyagi badge (today's behavior) rather than
 * throw on `undefined`.
 */
export function deriveChannelBadges(listing: ChannelBadgeInput): ChannelBadges {
  const channels = listing.channels ?? ['miyagi']
  return {
    miyagi: channels.includes('miyagi'),
    ml: channels.includes('ml'),
  }
}
