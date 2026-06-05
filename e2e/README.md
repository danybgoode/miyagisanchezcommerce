# e2e — the Playwright harness

Two layers, two purposes. Grow each by **one spec per new testable story**.

## `api` project — the deterministic gate (always-on)
API-level specs (`*.spec.ts`) hit public endpoints via the `request` fixture. No browser binaries →
fast and cheap. **Runs in CI on every PR** (`ci.yml`) and must be green before merge.

```bash
npm run test:e2e                                  # the gate
PLAYWRIGHT_BASE_URL=https://<preview> npm run test:e2e
```

Previews are SSO-gated — CI passes `VERCEL_AUTOMATION_BYPASS_SECRET` so the suite reaches them.

## `browser` project — opt-in real-browser smoke (NOT the gate)
`*.browser.spec.ts`, Chromium. Asserts *rendered* UI an API call can't see — a field renders before
the CTA, a counter ticks, a required-field nudge fires. Kept out of the blocking gate (binaries are
heavy/slow); run on demand, and nightly via `.github/workflows/browser-smoke.yml`.

```bash
npx playwright install chromium      # once
npm run test:e2e:browser
```

### Credentials & fixtures (skip gracefully when unset)

| env | for |
|---|---|
| `MS_TEST_PERSONALIZED_LISTING_ID` | a public listing with a **required** custom field (anonymous smoke) |
| `MS_TEST_BUYER_EMAIL` / `MS_TEST_BUYER_PASSWORD` | buyer authed flows |
| `MS_TEST_SELLER_EMAIL` / `MS_TEST_SELLER_PASSWORD` | seller authed flows |
| `MS_TEST_BROWSER_AUTH=1` | **master switch** for authed smokes (off by default) |

Any spec missing its fixture **skips with a clear reason** — never fails. So the harness is safe to
run anywhere, and coverage lights up as fixtures land. **Prefer anonymous assertions** — many client
islands (e.g. the personalization buy box) render + intercept *before* sign-in, so they need no auth.

> **Authed smokes are OFF by default (`MS_TEST_BROWSER_AUTH` unset).** The production Clerk instance
> is **email-code / OAuth-first** — password is enabled but the sign-in UI routes to an email-code
> second factor, so a headless password sign-in can't complete unaided. Turning authed smokes on
> needs the Clerk **testing-token** setup (`@clerk/testing`) + the prod Clerk keys in CI (a security
> decision). The `MS_TEST_BUYER_*` / `MS_TEST_SELLER_*` accounts are already provisioned and ready
> for that wiring.

## Conventions
- `_helpers/` is not a test dir (no `*.spec.ts`) — shared helpers only.
- A browser spec replaces a hand-driven browser smoke that was previously "owed to Daniel."
- Keep browser specs resilient: assert behaviour/landmarks, not volatile copy or layout.
