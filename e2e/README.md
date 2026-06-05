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
Authed money-path smokes are Clerk-gated. Set env / CI secrets (see `e2e/_helpers/auth.ts`):

| env | for |
|---|---|
| `MS_TEST_BUYER_EMAIL` / `MS_TEST_BUYER_PASSWORD` | buyer flows (password auth, not OTP-only) |
| `MS_TEST_SELLER_EMAIL` / `MS_TEST_SELLER_PASSWORD` | seller flows |
| `MS_TEST_PERSONALIZED_LISTING_ID` | a public listing with a **required** custom field |

Any spec missing its fixture **skips with a clear reason** — never fails. So the harness is safe to
run anywhere, and coverage lights up as fixtures land.

## Conventions
- `_helpers/` is not a test dir (no `*.spec.ts`) — shared helpers only.
- A browser spec replaces a hand-driven browser smoke that was previously "owed to Daniel."
- Keep browser specs resilient: assert behaviour/landmarks, not volatile copy or layout.
