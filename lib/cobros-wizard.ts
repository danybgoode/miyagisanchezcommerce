/**
 * lib/cobros-wizard.ts
 *
 * Pure step-resolution logic for the S7 cobros mini-wizard (onboarding
 * three-doors, Sprint 3 · Story 3.1). Zero imports — same "keep the pure
 * predicate out of any file importing @clerk/nextjs/server" discipline as
 * lib/seller-mode.ts / lib/sell-shell-path.ts, so an `api` Playwright spec
 * can load it directly with no Clerk-resolution failure.
 *
 * The wizard wraps the EXISTING MercadoPago OAuth unchanged — this module
 * only decides which of the 3 steps to show and what banner to render, from
 * the query params the callback redirects with plus the shop's already-known
 * connected state. It never touches tokens.
 */

export type CobrosWizardBanner = 'connected' | 'error' | null

export interface CobrosWizardStepResult {
  step: 1 | 2 | 3
  banner: CobrosWizardBanner
  errorReason?: string
}

export function resolveCobrosWizardStep(params: {
  mp?: string | null
  reason?: string | null
  mpConnected: boolean
}): CobrosWizardStepResult {
  if (params.mp === 'connected') {
    return { step: 2, banner: 'connected' }
  }
  if (params.mp === 'error') {
    return { step: 1, banner: 'error', errorReason: params.reason ?? undefined }
  }
  // No round-trip query param — a returning seller who already connected lands
  // straight on the done step; a fresh seller starts at the top.
  return params.mpConnected ? { step: 3, banner: null } : { step: 1, banner: null }
}
