# e2e — the Playwright harness

Three layers, three purposes. Grow each by **one spec per new testable story**.

## `api` project — the deterministic gate (always-on)
API-level specs (`*.spec.ts`, excluding `*.browser.spec.ts` and `*.staging.spec.ts`) hit public
endpoints via the `request` fixture, against `baseURL`. No browser binaries → fast and cheap.
**Runs in CI on every PR** (`ci.yml`) and must be green before merge.

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

## `staging` project — opt-in, deliberately different host (NOT the gate)
`*.staging.spec.ts`. Same `request`-fixture shape as `api`, but the spec targets a host OTHER than
`baseURL` on purpose — e.g. an infra-migration staging hostname
(`09-platform-infra/frontend-vercel-to-cloudrun`'s `gcp.miyagisanchez.com`). Excluded from `api` for
exactly that reason: included there, it runs against the PR's Vercel preview and fails on a host
mismatch that isn't a real bug — this happened live (two specs shipped as plain `*.spec.ts`, got
swept into the CI gate, failed against the wrong host). Always invoke with an explicit
`PLAYWRIGHT_BASE_URL` pointed at the real target:

```bash
PLAYWRIGHT_BASE_URL=https://gcp.miyagisanchez.com npx playwright test --project=staging
```

### Anonymous smokes (preview/prod) — `MS_TEST_PERSONALIZED_LISTING_ID`
A public listing with a **required** custom field lights up the personalization buy-box smoke. Unset →
skips. **Prefer anonymous assertions** — many client islands (e.g. the personalization buy box)
render + intercept *before* sign-in, so they need no auth and run against any deploy.

### Authed smokes — run **locally against a dev server** (validated working)
Auth uses `@clerk/testing` **ticket** sign-in (no password/OTP/2FA). Clerk's testing token is
**dev-instance only** and the dev instance only allows **localhost** as an origin — so authed smokes
run against `npm run dev`, **not** an SSO-gated ephemeral preview (where clerk-js can't hydrate) or
prod. `e2e/global.setup.ts` arms the token; `_helpers/auth.ts` does the sign-in.

```bash
# 1) boot the app (uses .env.local → the dev Clerk instance)
npm run dev                       # http://localhost:3001

# 2) in another shell — point the browser project at it, with the DEV Clerk keys
#    (CLERK_PUBLISHABLE_KEY/CLERK_SECRET_KEY must be the SAME instance the app serves)
PLAYWRIGHT_BASE_URL=http://localhost:3001 \
MS_TEST_BROWSER_AUTH=1 \
CLERK_PUBLISHABLE_KEY=<dev pk_test> CLERK_SECRET_KEY=<dev sk_test> \
MS_TEST_BUYER_EMAIL=<dev user email> \
  npm run test:e2e:browser
```

| env | for |
|---|---|
| `MS_TEST_BROWSER_AUTH=1` | master switch for authed smokes (off by default → skip) |
| `CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` | **dev** Clerk instance keys (must match the app's) |
| `MS_TEST_BUYER_EMAIL` / `MS_TEST_SELLER_EMAIL` | a user that exists in that dev instance |

> **Instance-match gotcha:** the keys, the test users, and the app must all be the **same** Clerk
> instance, or `clerk.signIn` times out waiting for `window.Clerk`. Decode a publishable key with
> `echo <suffix> | base64 -d` to see its frontend-API host. CI runs only the **anonymous** browser
> smokes against the preview (non-blocking); authed is a local run.

## Conventions
- `_helpers/` is not a test dir (no `*.spec.ts`) — shared helpers only.
- A browser spec replaces a hand-driven browser smoke that was previously "owed to Daniel."
- Keep browser specs resilient: assert behaviour/landmarks, not volatile copy or layout.
