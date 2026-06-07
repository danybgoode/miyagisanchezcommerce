---
name: project-design-system
description: Design System v2 (miyagi-s-nchez-design-system) was fully integrated into the app in May 2026
metadata:
  type: project
---

Design System v2 was integrated into `app/globals.css` and `app/layout.tsx`, then documented and guarded
by the Roadmap Design-Token Foundation epic in June 2026.

**Why:** The design system was built separately in `miyagi-s-nchez-design-system/` and needed to be wired into the running Next.js app.

**What was done:**
- `app/globals.css` — expanded from ~36 to ~400 lines: full color scales (selva, jamaica, azafran, anil, papel), semantic aliases (`--accent`, `--bg`, `--fg`, etc.), Liquid Glass tokens, shadows, radii, spacing, motion easings, type utilities (`.t-*`), glass helpers (`.glass`, `.glass-accent`, `.glass-agent`), component primitives (`.btn`, `.btn-primary`, `.chip`, `.card-tile`, `.badge`, `.input`), feedback animations (shimmer, spin, pulse-soft, toast-in)
- `app/layout.tsx` — Google Fonts preconnect + Space Grotesk stylesheet, Iconoir CDN stylesheet, floating glass header (`<div sticky> <header class="glass">`) with pill CTA button (`.btn .btn-primary .btn-sm`), `app-shell` footer
- Roadmap contract — `Roadmap/09-platform-infra/design-token-foundation/token-contract.md` names the canonical semantic tokens, the `--color-*` compatibility layer, the locked-vs-unlockable theme matrix, and the guard exclusions.
- Guard seam — `lib/design-token-audit.ts` plus `e2e/design-token-foundation.spec.ts` check documented WCAG AA token pairs and fail on new raw hex/arbitrary hex utilities in customer-facing source.

**Key decisions:**
- Existing `--color-*` Tailwind tokens kept intact (existing codebase uses them); design system `--accent` / `--bg` etc. alias them via `var(--color-*)`
- Product/UI work should use semantic names (`--accent`, `--bg`, `--fg-muted`, feedback tokens) rather than raw hex or `--color-*` product language.
- `--warning` and `--promo` use `#95590c` so warning/promo text on soft backgrounds passes WCAG AA body contrast.
- `--fg-subtle` is reserved for placeholder/metadata affordances; body copy must use `--fg-muted` or stronger.
- Email, print/PDF, OG/image generation, admin/API, sandbox, token infrastructure, and narrow serialized embed/support/config fallbacks are intentionally excluded or line-allow-listed by the raw-hex guard.
- Emoji not replaced — design system README says that's a separate future PR
- Font: Space Grotesk loaded via Google Fonts CDN `<link>` (no `geist` package installed for Mono; system monospace fallback)
- Iconoir loaded via jsDelivr CDN, same as design system spec

**How to apply:** Use `.glass`, `.btn-primary`, `.chip`, `.card-tile`, `.badge-*`, `.t-*`, and semantic
CSS vars directly on JSX elements — they're all in globals.css. If a new visual concept needs a raw value,
add a named semantic token first and update the Roadmap contract/guard rationale.
