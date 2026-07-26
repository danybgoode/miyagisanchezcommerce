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

### `scripts/live-smoke.mjs` — the default interactive entry point (any agent)
Wraps this project for on-demand verification during a build session (as opposed to the permanent
regression suite above). **The default tool for "does this actually render correctly" — for any
coding agent, not just Claude Code; no Claude-in-Chrome access needed.** Two modes: `--path` for an
ad-hoc check against one URL (nothing permanent left behind — for active-development "does this
look right" moments), `--spec` to run an existing committed `*.browser.spec.ts` by name. Emits a
JSON report + a screenshot to `test-results/live-smoke/` that the calling agent reads back, rather
than just an exit code.

```bash
node scripts/live-smoke.mjs --env=prod  --flow=unauthed --path=/vende/migracion
node scripts/live-smoke.mjs --env=local --flow=admin    --path=/admin/promoter
```

Full usage, the honest environment × auth matrix, and the Claude-in-Chrome fallback boundary:
`skills/live-smoke/SKILL.md` (root repo).

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

### Authed smokes — dev Clerk only (preview CI or local)
Auth uses `@clerk/testing` **ticket** sign-in (no password/OTP/2FA). Clerk rejects its testing token
for production secret keys, so the scheduled production job is deliberately anonymous. The preview
path in `ci.yml` is the only CI path with `MS_TEST_BROWSER_AUTH=1`; it maps the dedicated dev-instance
GitHub secrets `MS_TEST_CLERK_PUBLISHABLE_KEY` / `MS_TEST_CLERK_SECRET_KEY` to the standard Clerk env
names. If either key or a needed fixture is absent, the affected tests skip and the job stays green.

Every browser run writes `test-results/browser-smoke-fixture-skips.json`; both workflows publish its
authed-skip count and missing fixture **names only** in the GitHub Actions job summary, then upload the
JSON as `browser-smoke-fixture-skips`.

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
> `echo <suffix> | base64 -d` to see its frontend-API host. The preview CI browser layer is
> non-blocking; its credentialed tests are informative rather than a merge gate.

### Fixture inventory (derived from `e2e/**/*.spec.ts`)

The table is the provisionable `MS_TEST_*` surface actually referenced by the spec tree. `ci.yml`
wires the API and browser fixtures; `browser-smoke.yml` wires the browser-only anonymous subset for
the production nightly. A missing fixture is a visible skip, not a failure.

| Env var | Specs unlocked | Fixture requirement |
| --- | --- | --- |
| `MS_TEST_BROWSER_AUTH` | all auth-gated browser specs | Literal `1`; set only in the preview CI job or a local dev-Clerk run. |
| `MS_TEST_BUYER_EMAIL` | `smoke`, `home-hero-auth`, `home-personalization`, `buyer-notification-prefs-compras`, `checkout-cp-first`, `unread-poll` browser specs | Existing buyer in the same dev Clerk instance as the target. |
| `MS_TEST_SELLER_EMAIL` | `onboarding-success-card`, shop-settings, `seller-unclaimed-s3` browser specs | Existing seller in that dev Clerk instance. |
| `MS_TEST_ADMIN_EMAIL` | `admin-seleccion.browser.spec.ts` | Dev Clerk user recognized as an admin by the app. This spec requires its explicit email. |
| `MS_TEST_PDP_LISTING_ID` | `agent-prompt`, `trust-signals` browser; `ucp-cutover-api` | Public listing; seller exposes a payment or fulfillment method for trust-signals. |
| `MS_TEST_PERSONALIZED_LISTING_ID` | `personalization`, PDP gallery fallback; `agent-prompt`, `trust-signals`, `ucp-cutover-api` fallbacks | Public listing with a required custom field. |
| `MS_TEST_GALLERY_LISTING_ID` | `pdp-gallery.browser.spec.ts` | Public listing with at least two photos. |
| `MS_TEST_GALLERY_SINGLE_LISTING_ID` | `pdp-gallery.browser.spec.ts` | Public listing with exactly one photo. |
| `MS_TEST_GALLERY_ZERO_LISTING_ID` | `pdp-gallery.browser.spec.ts` | Public listing with zero photos. |
| `MS_TEST_SHIPPABLE_LISTING_ID` | `checkout-cp-first.browser.spec.ts`, `ucp-checkout-session-shipping-boundary.spec.ts` | Public, priced physical listing with Envía shipping. |
| `MS_TEST_CLAIMED_SLUG` | `seller-unclaimed-s3.browser.spec.ts`, `collection-isolation.spec.ts` | A real claimed shop slug. |
| `MS_TEST_UNCLAIMED_LISTING_ID` | `unclaimed-pdp.browser.spec.ts`, `unclaimed-guardrails.spec.ts` | Public listing on a “Sin reclamar” shop. |
| `MS_TEST_GTM_ID` | `site-analytics-loader.browser.spec.ts` | Set to `1` only when the target build has `NEXT_PUBLIC_GTM_ID`; this is a repo variable, not a secret. |
| `MS_TEST_ARRANGED_LISTING_ID` | `ucp-checkout-session-arranged-delivery.spec.ts` | Public, priced listing using coordinated delivery. |
| `MS_TEST_EVENT_LISTING_ID` | `ucp-checkout-quantity.spec.ts`, `ucp-rental-quote.spec.ts` | Public, priced event listing (the rental spec uses it as a non-rental control). |
| `MS_TEST_RENTAL_LISTING_ID` | `ucp-rental-quote.spec.ts` | Public, priced rental listing. |
| `MS_TEST_PRINT_STUDIO_SUBMISSION_ID` | `print-studio-api.spec.ts` | Disposable approved print-studio submission; also requires `PRINT_STUDIO_TOKEN`. |
| `MS_TEST_PRINT_STUDIO_SOCIAL_ID` | `print-studio-api.spec.ts` | Disposable approved social submission; also requires `PRINT_STUDIO_TOKEN`. |
| `MS_TEST_PRINT_STUDIO_EDITION_ID` | `print-studio-api.spec.ts` | Existing `print_editions` UUID for the social-placement check. |
| `MS_TEST_PERSONALIZATION_STRICT` | `home-personalization.browser.spec.ts` | Optional `1`: strengthens an already-running assertion; it does not unlock a skipped test. |

`CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` are also required for credentialed tests, but are not
`MS_TEST_*` names. CI maps them from the dedicated dev-instance secrets above. `MS_TEST_BUYER_PASSWORD`
and `MS_TEST_SELLER_PASSWORD` are vestigial: no spec references either, because ticket sign-in needs
only an email plus the Clerk secret key. Do not provision them.

## Conventions
- `_helpers/` is not a test dir (no `*.spec.ts`) — shared helpers only.
- A browser spec replaces a hand-driven browser smoke that was previously "owed to Daniel."
- Keep browser specs resilient: assert behaviour/landmarks, not volatile copy or layout.
