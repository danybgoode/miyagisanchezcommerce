import type { APIRequestContext } from '@playwright/test'

/**
 * e2e/_helpers/gallery-fixture.ts
 *
 * Resolves a PDP-gallery fixture listing by PHOTO COUNT, from the live public
 * catalog, instead of from a hand-rotated GitHub Actions secret.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * On 2026-08-15 the nightly browser smoke went red on three gallery specs, all
 * with the same opaque `getByTestId('pdp-gallery')` timeout. Nothing was wrong
 * with the gallery: `MS_TEST_GALLERY_SINGLE_LISTING_ID` and
 * `MS_TEST_GALLERY_ZERO_LISTING_ID` pointed at listings on two throwaway shops
 * (`prueba`, `ricas-tortas`) that an admin had deleted through /admin/tenants
 * six hours earlier — a correct, intentional use of a feature that had shipped
 * the day before. The secrets were last rotated 2026-07-13.
 *
 * That is not a one-off. A fixture pinned to an id in a secret is a claim about
 * production data that nobody re-checks, made in a place (Actions secrets) that
 * is invisible from the codebase and that most people cannot read. It rots
 * silently and then presents as a product regression at 09:23 UTC.
 *
 * The catalog API already publishes exactly what these specs need — public
 * listings with their images — and it is authoritative by construction: if a
 * listing is not in it, there is no PDP to test. So the fixture is discovered,
 * and the secret becomes an optional override for pinning a specific listing.
 *
 * ── The pin is checked, never trusted ───────────────────────────────────────
 * The override shipped 2026-08-15 as a blind pass-through: any non-empty env
 * var short-circuited discovery entirely. `MS_TEST_GALLERY_SINGLE_LISTING_ID`
 * and `MS_TEST_GALLERY_ZERO_LISTING_ID` were never cleared from the workflow
 * after that rotted once already, so the smoke kept trusting the same
 * hand-rotated secrets discovery was built to stop depending on — and went red
 * again on 2026-08-16 the same way. A pin is now cross-checked against the
 * catalog page(s) already being fetched (right shape, still present) before
 * it is used; a pin that fails that check is treated as absent and discovery
 * runs instead, same as if the secret had never been set.
 *
 * ── Three states, never two ─────────────────────────────────────────────────
 * `resolveGalleryListing` returns a listing id, or `null` with a `reason`. It
 * never conflates "the catalog has no listing of this shape" with "the catalog
 * could not be read" — the first is a real gap in the data the caller should
 * name out loud, the second is an outage. A skip that hides either one is the
 * green-having-run-nothing failure the repo bans.
 */

export type PhotoCount = 'zero' | 'single' | 'multi'

export interface GalleryFixture {
  /** The listing to test, or `null` when none of this shape is available. */
  listingId: string | null
  /** Why there is none. Always set when `listingId` is null; never when it is not. */
  reason?: string
  /** Whether the id came from an env override rather than discovery — reported, not inferred. */
  source: 'env' | 'catalog' | 'unavailable'
}

export interface CatalogItem {
  id: string
  images?: unknown[]
}

const MATCHES: Record<PhotoCount, (n: number) => boolean> = {
  zero: (n) => n === 0,
  single: (n) => n === 1,
  multi: (n) => n >= 2,
}

const DESCRIPTION: Record<PhotoCount, string> = {
  zero: 'zero photos',
  single: 'exactly one photo',
  multi: 'two or more photos',
}

/**
 * `limit=50` is the catalog's own server-side cap — asking for more silently
 * returns 50, so paging is explicit rather than trusted to a bigger number.
 * Two pages covers the whole live catalog today with room to spare; a fixture
 * that exists only past page 2 of a much larger catalog would report as
 * unavailable, which is the safe direction to be wrong in.
 */
const PAGES = [1, 2]

export async function resolveGalleryListing(
  request: APIRequestContext,
  photos: PhotoCount,
  envOverride?: string,
): Promise<GalleryFixture> {
  const items: CatalogItem[] = []
  for (const page of PAGES) {
    let response
    try {
      response = await request.get(`/api/ucp/catalog?limit=50&page=${page}`)
    } catch (error) {
      return {
        listingId: null,
        source: 'unavailable',
        reason: `catalog request failed: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
    if (!response.ok()) {
      // An unreachable catalog is an OUTAGE, not "there is no such listing".
      // Reported as its own state so a red smoke is not read as missing data.
      return {
        listingId: null,
        source: 'unavailable',
        reason: `catalog returned HTTP ${response.status()} — could not look for a listing with ${DESCRIPTION[photos]}`,
      }
    }
    const body = (await response.json()) as { items?: CatalogItem[] }
    const page_items = body.items ?? []
    items.push(...page_items)
    if (page_items.length < 50) break
  }

  // A pin only counts if the catalog still lists it WITH the right photo
  // count — anything else (deleted, unpublished, edited to a different photo
  // count, or just outside the two pages fetched above) is indistinguishable
  // from "never pinned" and falls through to discovery below.
  if (envOverride) {
    const pinned = items.find((item) => item.id === envOverride)
    if (pinned && MATCHES[photos]((pinned.images ?? []).length)) {
      return { listingId: envOverride, source: 'env' }
    }
  }

  const match = pickFixtureListing(items, photos)
  if (match) return { listingId: match, source: 'catalog' }

  return {
    listingId: null,
    source: 'unavailable',
    reason:
      `no public listing with ${DESCRIPTION[photos]} exists in the catalog ` +
      `(searched ${items.length})` +
      (envOverride ? `; the pinned id no longer qualifies either` : '') +
      `. This spec cannot run until one does — that is a gap in the ` +
      `test DATA, not a passing test.`,
  }
}

/**
 * The pure half: which of these listings should the spec use?
 *
 * Deterministic and LIGHT, in that order.
 *
 * Deterministic: "the first match in catalog order" reshuffles whenever the
 * catalog does, so two runs a day apart test different listings and a flake is
 * unreproducible. Sorting by (image count, then id) fixes the choice to the
 * DATA rather than to the response order.
 *
 * Light: `page.goto` waits for `load`, which waits for every image. The first
 * multi-photo listing in catalog order happened to be a ten-image one, and
 * navigating to it exceeded the 30s test timeout under four parallel workers —
 * found by running this against production, not by review. Fewest-images-that-
 * still-qualifies keeps the spec testing the same PROPERTY (2+ photos, so
 * thumbnails, arrows and the counter all render) on the cheapest possible page.
 */
export function pickFixtureListing(items: readonly CatalogItem[], photos: PhotoCount): string | null {
  const match = items
    .filter((item) => MATCHES[photos]((item.images ?? []).length))
    .sort((a, b) => {
      const byCount = (a.images ?? []).length - (b.images ?? []).length
      return byCount !== 0 ? byCount : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })[0]
  return match?.id ?? null
}
