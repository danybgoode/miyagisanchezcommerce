'use client'

import Link from 'next/link'
import type { NavNamespaceGroup } from '@/lib/copy-overrides-page-nav'
import { NO_SINGLE_PAGE_LABEL } from '@/lib/copy-overrides-routes'

/** `/admin/contenido?namespace=…&section=…` — always resets q/status/sort/page, a deliberate fresh start per group. */
function navHref(namespace: string, section: string): string {
  const sp = new URLSearchParams({ namespace, section })
  return `/admin/contenido?${sp.toString()}`
}

/**
 * Page-first sub-navigation for `/admin/contenido` (epic 08 ·
 * cms-contenido-restore-and-polish, Story 3.1) — lists every namespace/section
 * group (from `buildPageNavGroups`, the SAME grouping the editor used to
 * render as a nested `<details>` accordion) as clickable links instead, so
 * Daniel picks a page instead of paging through a flat key list. Lives
 * INSIDE `ContenidoAdminClient`'s own column, not a new shell — `AdminShell`
 * stays the one outer admin rail.
 *
 * Sprint 4: fixes every sibling section rendering identical text (a
 * screenshot review caught it — the group header and every child showed the
 * SAME shared page label). Each item now shows its own friendly section
 * name (`entry.label`) as the primary text. The group's real destination
 * shows ONCE next to the group header when every section shares it
 * (`group.uniformRoute` — true for e.g. `home`); when a group's sections
 * genuinely point at different surfaces (`sweepstakes`, `events`,
 * `sellerAcquisition`), each item shows its OWN destination inline instead,
 * so you can tell what a section does without opening it.
 *
 * `guard` (wired by Story 3.2) lets the caller block navigation while there
 * are unsaved batched-save drafts; omitted, every click navigates normally.
 *
 * 2026-08-15: each namespace is now a `<details>`, open only when it holds the
 * active section. Repairing the `sellerCopy` grouping took the nav from ~2600
 * entries to 110 — a vast improvement and still a long scroll in a 220px
 * column, which is what Daniel meant by listing this page as "not paginated".
 * Twelve collapsed headers with one expanded group is the right shape for a
 * page-first nav: you scan domains, then pages, instead of scanning 110 links.
 *
 * No React state backs it, deliberately: the server already knows which group
 * is active from the URL, so there is nothing to synchronise. React writes
 * `open` only when the value it computes CHANGES, which means a group opened by
 * hand (React's prop stayed `false` throughout) survives re-renders, while
 * navigating to another group closes this one. Holding it in state instead
 * would slam a hand-opened group shut on the next render.
 */
export default function ContenidoPageNav({
  groups,
  activeNamespace,
  activeSection,
  guard,
}: {
  groups: NavNamespaceGroup[]
  activeNamespace: string
  activeSection: string
  guard?: () => boolean
}) {
  return (
    <nav aria-label="Páginas de contenido" style={{ width: 220, flexShrink: 0 }}>
      {groups.map((group) => (
        <details
          key={group.namespace}
          // Open on the group holding the active section. React writes the
          // `open` attribute only when this VALUE changes between renders, so
          // navigating to another group closes this one (true → false) while a
          // group the user opened by hand — where React's prop stayed false the
          // whole time — is left alone. That is the behaviour we want, and it
          // is a property of how React reconciles `open`, not of `key`.
          open={group.namespace === activeNamespace}
          style={{ marginBottom: 8 }}
        >
          <summary
            data-testid={`nav-group-${group.namespace}`}
            className="pressable"
            style={{
              padding: '4px 8px',
              cursor: 'pointer',
              borderRadius: 'var(--r-md)',
              listStyle: 'none',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              gap: 8,
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: group.namespace === activeNamespace ? 'var(--accent-ink)' : 'var(--fg-subtle)',
              }}
            >
              {group.label}
            </span>
            {/* The group's own size, so a collapsed group still says how much is
                inside it — otherwise collapsing just hides information. */}
            <span style={{ fontSize: 10, color: 'var(--fg-subtle)', flexShrink: 0 }}>{group.count}</span>
          </summary>
          <div style={{ marginBottom: 8 }}>
            <div style={{ padding: '2px 8px 4px' }}>
              {group.uniformRoute && (
                <div
                  style={{
                    fontSize: 10,
                    color: 'var(--fg-subtle)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {group.uniformRoute.path}
                </div>
              )}
            </div>
          {group.sections.map((entry) => {
            const active = group.namespace === activeNamespace && entry.section === activeSection
            return (
              <Link
                key={entry.section}
                href={navHref(group.namespace, entry.section)}
                onClick={(e) => {
                  if (guard && !guard()) e.preventDefault()
                }}
                aria-current={active ? 'page' : undefined}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: 8,
                  padding: '6px 8px',
                  marginBottom: 2,
                  borderRadius: 'var(--r-md)',
                  textDecoration: 'none',
                  fontSize: 13,
                  fontWeight: active ? 600 : 400,
                  color: active ? 'var(--accent-ink)' : 'var(--fg)',
                  background: active ? 'var(--accent-soft)' : 'transparent',
                }}
              >
                <span style={{ overflow: 'hidden', minWidth: 0 }}>
                  <span
                    style={{
                      display: 'block',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {entry.label}
                  </span>
                  {!group.uniformRoute && (
                    <span
                      style={{
                        display: 'block',
                        fontSize: 10,
                        color: entry.route ? (active ? 'var(--accent-ink)' : 'var(--fg-subtle)') : 'var(--warning)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {entry.route ? entry.route.path : `⚠ ${NO_SINGLE_PAGE_LABEL}`}
                    </span>
                  )}
                </span>
                <span style={{ fontSize: 11, color: active ? 'var(--accent-ink)' : 'var(--fg-muted)', flexShrink: 0 }}>
                  {entry.count}
                </span>
              </Link>
            )
          })}
          </div>
        </details>
      ))}
    </nav>
  )
}
