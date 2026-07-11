/**
 * lib/onboarding-timing.ts
 *
 * Client-only helper backing the `time_to_first_product` / `time_to_payable`
 * metrics (onboarding three-doors Sprint 3 · Story 3.3). Mirrors
 * lib/onboarding-skip.ts's shape (one tiny, single-purpose helper, one
 * storage key) — localStorage rather than a cookie since a full onboarding
 * run (catalog import → cobros connect, possibly across a session gap) can
 * outlive a short-lived cookie.
 */
const STORAGE_KEY = 'miyagi_onboarding_started_at'

/** Call once, at the earliest onboarding entry point (Bienvenida). */
export function markOnboardingStart() {
  try {
    if (!window.localStorage.getItem(STORAGE_KEY)) {
      window.localStorage.setItem(STORAGE_KEY, String(Date.now()))
    }
  } catch {
    // localStorage blocked — the elapsed-time metrics simply won't fire, no functional impact.
  }
}

/** Milliseconds since `markOnboardingStart()`, or `null` if never marked (e.g. an existing seller). */
export function getOnboardingElapsedMs(): number | null {
  try {
    const started = window.localStorage.getItem(STORAGE_KEY)
    if (!started) return null
    return Date.now() - Number(started)
  } catch {
    return null
  }
}
