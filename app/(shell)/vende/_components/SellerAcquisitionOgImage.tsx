/**
 * Re-exports the shared marketing OG template (`lib/marketing-og.tsx`,
 * agent-readability-marketing-surface epic, Story 1.2) under this module's
 * original names, so the 11 existing per-page opengraph-image.tsx files
 * under vende/ keep working unchanged. New pages should import
 * `createMarketingOgImage` from `@/lib/marketing-og` directly.
 */
export {
  createMarketingOgImage as createSellerAcquisitionOgImage,
  marketingOgSize as sellerAcquisitionOgSize,
  marketingOgContentType as sellerAcquisitionOgContentType,
} from '@/lib/marketing-og'
