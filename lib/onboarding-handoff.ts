/**
 * Client-only sessionStorage handoff between the S3 drop-anything intake
 * (`/sell/agente`) and the existing SetupClient staging preview
 * (`/sell/setup`) — onboarding three-doors Sprint 1 · Story 1.3. S4's
 * restyle of that staging preview is Sprint 2 work; for Sprint 1 a
 * successfully-parsed CSV/JSON just lands on today's (unstyled) staging UI,
 * matching the sprint's own smoke walkthrough. One fixed key, single source
 * of truth for both call sites so they can't drift.
 */
const HANDOFF_KEY = 'miyagi_onboarding_setup_file'

export function stashSetupFile(rawJsonText: string) {
  try {
    sessionStorage.setItem(HANDOFF_KEY, rawJsonText)
  } catch {
    // sessionStorage unavailable — the file just won't auto-load on
    // /sell/setup; the paste box there still works.
  }
}

/** Reads AND clears the stashed file — consumed at most once. */
export function consumeSetupFile(): string | null {
  try {
    const v = sessionStorage.getItem(HANDOFF_KEY)
    if (v !== null) sessionStorage.removeItem(HANDOFF_KEY)
    return v
  } catch {
    return null
  }
}
