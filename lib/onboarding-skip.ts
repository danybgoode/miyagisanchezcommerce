/**
 * Client-only helper: sets the one-tab-session signal that tells `/sell`'s
 * server-side redirect (onboarding three-doors Sprint 1 · Story 1.1) not to
 * loop a merchant back into S1/S2 after they deliberately chose to explore
 * on their own (the Bienvenida ghost CTA and Door 3 both call this). Kept
 * here as the single source of truth for the cookie name/lifetime so the
 * two call sites can't drift.
 */
export function setOnboardingSkipSignal() {
  document.cookie = 'onboarding_skip=1; path=/; max-age=3600'
}
