---
name: seasonal-theme-engine
description: Platform-only seasonal brand collaboration theme engine implemented June 2026
metadata:
  type: project
---

Seasonal Theme Engine was implemented on `feat/seasonal-theme-engine` for the main Miyagi Sanchez platform shell.

**Scope:**
- Applies only to public platform browsing surfaces: `/`, `/l`, `/l/*`, and `/agent`.
- Excludes custom-domain storefronts, `/embed/*`, seller storefront routes, seller dashboards, admin, account, auth, checkout, payment, and APIs.
- PWA icons, splash screens, manifest metadata, checkout, and seller storefront branding remain core in v1.

**Implementation facts:**
- `lib/platform-theme.ts` owns the manifest, fallback/contrast guardrails, scope helpers, payload, and pre-paint bootstrap script.
- `app/components/PlatformThemeScript.tsx` injects the bootstrap with Next `beforeInteractive`; in App Router dev HTML this appears in `self.__next_s`, not as a literal `<script id="...">` tag.
- `app/components/PlatformThemeToggle.tsx` persists `miyagi:platform-theme` in localStorage and applies/removes `data-platform-theme` plus safe CSS variables.
- `app/components/PlatformBrand.tsx` reserves fixed desktop/mobile brand dimensions so the DesignerN logo treatment does not shift header layout.
- `app/api/platform-theme/route.ts` exposes sanitized manifest/scope data for smoke tests and future ops visibility.

**QA caveats:**
- Focused touched-file lint, `npx tsc --noEmit`, `npm run build`, and `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3002 npx playwright test e2e/platform-theme.spec.ts` passed on 2026-06-05.
- Full `npm run lint` is blocked by existing baseline errors outside the epic.
- Local standalone Playwright browser binaries are not installed; full click-through browser smoke should be run on preview or after installing browsers.
