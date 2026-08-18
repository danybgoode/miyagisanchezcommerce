import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { navEntries, sectionPath, normalizeSections } from '../lib/shop-presentation/sections'
import { visibleEntries } from '../lib/wall/feed'
import { orderPublicWall, paginate } from '../lib/wall/visibility'
import { WALL_PAGE_SIZE } from '../lib/wall/validate'
import { ALL_SECTIONS, type SectionAvailability } from '../lib/shop-presentation/types'
import type { PublicWallEntry } from '../lib/wall/types'

const ROOT = path.resolve(import.meta.dirname, '..')

/**
 * Living Shop · Sprint 7 — cross-channel parity, edge states and budgets
 * (Stories 7.1, 7.2, 7.4, 7.5).
 *
 * Observed red by hardcoding a `/mx/s/` prefix into `sectionPath` (the
 * owned-host parity cases failed) and by making the sitemap derive its own
 * section list instead of reusing `navEntries` (the one-derivation test failed).
 */

const allAvailable: SectionAvailability = {
  collections: true, events: true, about: true, faq: true, policies: true,
}

test.describe('cross-channel parity · one nav, three channels (Story 7.1)', () => {
  test('every section resolves on all three channels from ONE base path', () => {
    const owned = navEntries(normalizeSections({}), allAvailable, '')
    const marketplace = navEntries(normalizeSections({}), allAvailable, '/mx/s/mi-tienda')

    // Same sections, same order — only the prefix differs. That is the whole
    // parity guarantee, and it holds because there is no per-channel branch.
    expect(owned.map((e) => e.key)).toEqual(marketplace.map((e) => e.key))
    for (let i = 0; i < owned.length; i++) {
      const suffix = marketplace[i].path.replace('/mx/s/mi-tienda', '')
      expect(suffix === '' ? '/' : suffix).toBe(owned[i].path)
    }
  })

  test('an owned host never leaks a marketplace prefix into a link', () => {
    for (const key of ALL_SECTIONS) {
      expect(sectionPath(key, ''), key).not.toContain('/s/')
      expect(sectionPath(key, ''), key).not.toContain('/mx')
    }
  })

  test('the embed is deliberately untouched — no Wall, no section nav', () => {
    // Explicitly out of scope. Asserted rather than left to memory, because
    // "we did not add it" is invisible in a diff a year from now.
    const embedDir = path.join(ROOT, 'app/(shell)/embed')
    const files = readdirRecursive(embedDir)
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      expect(source, file).not.toContain('WallFeed')
      expect(source, file).not.toContain('ShopSectionNav')
    }
  })
})

function readdirRecursive(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) out.push(...readdirRecursive(full))
    else if (name.endsWith('.tsx') || name.endsWith('.ts')) out.push(full)
  }
  return out
}

test.describe('SEO · the sitemap lists exactly what the nav lists (Story 7.2)', () => {
  const sitemap = readFileSync(path.join(ROOT, 'app/sitemap.ts'), 'utf8')

  test('the tenant sitemap derives its sections through navEntries, not its own list', () => {
    // Two independent derivations of "which sections exist" is how a hidden page
    // ends up indexed while its nav link is correctly absent.
    //
    // The first version of this test asserted `toContain('navEntries')`, which a
    // mutation satisfied by merely RENAMING the import — a substring match is not
    // a call. It now asserts the call site and, more importantly, the ABSENCE of
    // a hand-written path list, which is the thing that would actually drift.
    expect(sitemap).toMatch(/navEntries\(\s*sectionConfig/)
    expect(sitemap).toContain('resolveSectionAvailability(')
    for (const literal of ["'/acerca'", "'/faq'", "'/politicas'", "'/eventos'", "'/tienda'", "'/colecciones'"]) {
      expect(sitemap, `${literal} is hand-written into the sitemap`).not.toContain(literal)
    }
  })

  test('the Wall homepage is emitted once, not twice', () => {
    expect(sitemap).toContain("entry.key !== 'wall'")
  })

  test('individual Wall entries are NOT separate indexable pages', () => {
    // The scope requires a durable per-entry route to be justified in build. It
    // was not built, so nothing may emit one.
    expect(sitemap).not.toMatch(/wall_entries|\/w\//)
  })
})

test.describe('edge states · one documented rule for a dead reference (Story 7.5)', () => {
  const entry = (over: Partial<PublicWallEntry>): PublicWallEntry => ({
    id: 'e1', kind: 'post', body: 'x', media: [], pinned: false,
    effective_at: '2026-08-18T10:00:00.000Z', reference: { state: 'none' }, ...over,
  })

  test('a deleted product, an unpublished one and a foreign one all disappear the same way', () => {
    const kept = visibleEntries([
      entry({ id: 'gone', kind: 'product', reference: { state: 'unavailable', reason: 'missing' } }),
      entry({ id: 'hidden', kind: 'product', reference: { state: 'unavailable', reason: 'unpublished' } }),
      entry({ id: 'foreign', kind: 'event', reference: { state: 'unavailable', reason: 'foreign' } }),
      entry({ id: 'fine' }),
    ])
    expect(kept.map((e) => e.id)).toEqual(['fine'])
  })

  test('deleting the pinned entry leaves no phantom pin', () => {
    // The pin lives on the ROW, so removing the row removes the pin — there is no
    // separate pointer that could survive it. This asserts the consequence.
    const remaining = orderPublicWall(
      [{ id: 'a', status: 'published' as const, published_at: '2026-08-18T09:00:00.000Z', scheduled_for: null, pinned: false }],
      new Date('2026-08-18T12:00:00Z'),
    )
    expect(remaining.filter((e) => e.pinned)).toHaveLength(0)
    expect(remaining).toHaveLength(1)
  })

  test('an empty Wall is an empty ORDER, never an error', () => {
    expect(orderPublicWall([], new Date())).toEqual([])
    expect(paginate([], 0, WALL_PAGE_SIZE)).toEqual({ items: [], hasMore: false })
  })
})

test.describe('performance · the Wall is bounded and its resolution is batched (Story 7.4)', () => {
  test('the initial page is capped', () => {
    expect(WALL_PAGE_SIZE).toBeLessThanOrEqual(12)
  })

  test('reference resolution is batched — three reads per page, never one per card', () => {
    // The N+1 this forbids: a per-entry resolver would make a twelve-card Wall
    // cost twelve round trips and grow with the merchant's output.
    const resolve = readFileSync(path.join(ROOT, 'lib/wall/resolve.ts'), 'utf8')
    expect(resolve).toContain('Promise.all')
    const body = resolve.slice(resolve.indexOf('export async function resolveWallEntries'))
    // The per-entry map must not contain an await — that would be the N+1.
    const mapBlock = body.slice(body.indexOf('return entries.map('), body.indexOf('function resolveOne'))
    expect(mapBlock).not.toContain('await')
  })

  test('Wall media is lazy and asynchronously decoded', () => {
    const card = readFileSync(path.join(ROOT, 'app/(shell)/_wall/WallEntryCard.tsx'), 'utf8')
    const imgCount = (card.match(/<img/g) ?? []).length
    expect(imgCount).toBeGreaterThan(0)
    expect((card.match(/loading="lazy"/g) ?? []).length).toBe(imgCount)
    expect((card.match(/decoding="async"/g) ?? []).length).toBe(imgCount)
  })

  test('every Wall image carries an alt attribute — none is omitted', () => {
    const card = readFileSync(path.join(ROOT, 'app/(shell)/_wall/WallEntryCard.tsx'), 'utf8')
    const imgs = card.match(/<img[\s\S]*?\/>/g) ?? []
    expect(imgs.length).toBeGreaterThan(0)
    for (const img of imgs) expect(img).toMatch(/alt=/)
  })
})

test.describe('accessibility · merchant expression never trades away access (Story 7.3)', () => {
  test('the Wall exposes a landmark and a real heading', () => {
    const feed = readFileSync(path.join(ROOT, 'app/(shell)/_wall/WallFeed.tsx'), 'utf8')
    expect(feed).toContain('aria-labelledby')
    expect(feed).toMatch(/<h2/)
  })

  test('post expansion is a BUTTON that names what it controls', () => {
    const body = readFileSync(path.join(ROOT, 'app/(shell)/_wall/WallPostBody.tsx'), 'utf8')
    expect(body).toContain('aria-expanded')
    expect(body).toContain('aria-controls')
    expect(body).toContain('type="button"')
    // And the full text is always in the DOM — the clamp is visual only, so a
    // screen reader and a crawler both get the whole post.
    expect(body).toContain('line-clamp-5')
    expect(body).not.toContain('slice(0,')
  })

  test('the section manager announces a reorder rather than moving silently', () => {
    const tab = readFileSync(path.join(ROOT, 'app/(shell)/shop/manage/tienda/SectionsTab.tsx'), 'utf8')
    expect(tab).toContain('aria-live')
    // Keyboard-reachable controls, not drag-and-drop.
    expect(tab).not.toMatch(/draggable|onDragStart/)
    expect(tab).toContain('aria-label')
  })

  test('the shop nav marks the current destination', () => {
    const nav = readFileSync(path.join(ROOT, 'app/(shell)/_shop-sections/ShopSectionNav.tsx'), 'utf8')
    expect(nav).toContain('aria-current')
    expect(nav).toContain('aria-label')
  })
})
