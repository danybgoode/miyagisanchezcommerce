/**
 * What KIND of target is this run pointed at, and what can it honestly test?
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * Reaching an SSO-gated Vercel preview means sending `x-vercel-protection-bypass`
 * on every request (see `playwright.config.ts`). That header turns third-party
 * script loads into CORS preflights, and Clerk's CDN refuses them:
 *
 *   Access to script at 'https://clerk.miyagisanchez.com/npm/@clerk/clerk-js@6/…'
 *   from origin 'https://miyagisanchez-<hash>.vercel.app' has been blocked by CORS
 *   policy: Redirect is not allowed for a preflight request.
 *
 * So on a preview, `window.Clerk` never readies and anything downstream of it is
 * degraded — not broken by our code, broken by the act of observing it. Two specs
 * were failing on EVERY preview run because of this, permanently:
 *
 *   · home-personalization — waits on `Clerk.loaded`, which cannot become true.
 *   · agent-prompt         — its rich prompt falls back to URL-only mode. Note the
 *                            earlier assertion in the same test (the canonical URL)
 *                            still passes, which is what identifies it as the
 *                            documented fallback rather than a broken card.
 *
 * ── Why SKIP and not a wider assertion ───────────────────────────────────────
 * Because the honest report is "I could not check here", and that is a third state,
 * distinct from both pass and fail. Loosening the assertions would make them pass on
 * a preview while no longer testing anything on production either — the worst of the
 * three. Leaving them red trains everyone to ignore a whole non-blocking layer, which
 * is how 12 real browser failures sat unread inside a green job.
 *
 * Coverage is not lost, it moves to where it is real: both specs are category A in
 * `scripts/smoke-sweep.manifest.json` and run against PRODUCTION, where Clerk loads
 * normally. Both verified passing there.
 *
 * The skip is loud, names the reason, and is scoped to `*.vercel.app` only — against
 * production or localhost these specs run in full, so the negation of the skip is
 * always available and a real regression still goes red.
 */

const DEFAULT_BASE_URL = 'https://miyagisanchez.com'

/** The base URL this run targets. Read from env, not `page.url()`, so it is
 *  answerable before the first navigation. */
export function targetBaseURL(): string {
  return process.env.PLAYWRIGHT_BASE_URL ?? DEFAULT_BASE_URL
}

/** True when the target is an ephemeral Vercel preview. */
export function onVercelPreview(): boolean {
  try {
    return /\.vercel\.app$/.test(new URL(targetBaseURL()).hostname)
  } catch {
    // An unparseable PLAYWRIGHT_BASE_URL is somebody's typo, not a preview. Returning
    // false keeps the specs RUNNING (and failing loudly) rather than skipping them,
    // because a skip caused by a malformed env var is exactly the silent hole this
    // module exists to close.
    return false
  }
}

/**
 * The reason string for a `test.skip()` on a preview-only client-JS limitation.
 * Kept here so every call site says the same thing and the skip is greppable.
 */
export const CLIENT_JS_UNAVAILABLE_ON_PREVIEW =
  'Not checkable on a Vercel preview: the x-vercel-protection-bypass header CORS-blocks clerk-js, ' +
  'so client-side session state never resolves. This spec runs against production ' +
  '(smoke-sweep category A), where Clerk loads normally.'
