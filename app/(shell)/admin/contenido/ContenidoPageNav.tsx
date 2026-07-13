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
        <div key={group.namespace} style={{ marginBottom: 16 }}>
          <div style={{ padding: '2px 8px 4px' }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--fg-subtle)',
              }}
            >
              {group.label}
            </div>
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
      ))}
    </nav>
  )
}
