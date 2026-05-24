---
name: project-design-system
description: Design System v2 (miyagi-s-nchez-design-system) was fully integrated into the app in May 2026
metadata:
  type: project
---

Design System v2 was integrated into `app/globals.css` and `app/layout.tsx`.

**Why:** The design system was built separately in `miyagi-s-nchez-design-system/` and needed to be wired into the running Next.js app.

**What was done:**
- `app/globals.css` — expanded from ~36 to ~400 lines: full color scales (selva, jamaica, azafran, anil, papel), semantic aliases (`--accent`, `--bg`, `--fg`, etc.), Liquid Glass tokens, shadows, radii, spacing, motion easings, type utilities (`.t-*`), glass helpers (`.glass`, `.glass-accent`, `.glass-agent`), component primitives (`.btn`, `.btn-primary`, `.chip`, `.card-tile`, `.badge`, `.input`), feedback animations (shimmer, spin, pulse-soft, toast-in)
- `app/layout.tsx` — Google Fonts preconnect + Space Grotesk stylesheet, Iconoir CDN stylesheet, floating glass header (`<div sticky> <header class="glass">`) with pill CTA button (`.btn .btn-primary .btn-sm`), `app-shell` footer

**Key decisions:**
- Existing `--color-*` Tailwind tokens kept intact (existing codebase uses them); design system `--accent` / `--bg` etc. alias them via `var(--color-*)`
- Emoji not replaced — design system README says that's a separate future PR
- Font: Space Grotesk loaded via Google Fonts CDN `<link>` (no `geist` package installed for Mono; system monospace fallback)
- Iconoir loaded via jsDelivr CDN, same as design system spec

**How to apply:** Use `.glass`, `.btn-primary`, `.chip`, `.card-tile`, `.badge-*`, `.t-*` classes directly on JSX elements — they're all in globals.css.
