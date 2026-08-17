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
 * ── The pin is CHECKED, never trusted ───────────────────────────────────────
 * That fix shipped with the override as a blind pass-through — `if (envOverride)
 * return it` — so any non-empty secret short-circuited discovery entirely. The
 * two secrets were never cleared, so the specs discovery was written for kept
 * getting handed the same dead ids and the smoke stayed red on 08-16 and 08-17.
 * A guard that the rotted input can walk straight past is not a guard.
 *
 * So a pin is now resolved against the live catalog before it is used, and a pin
 * that fails that check is treated exactly like an unset one. Which is also the
 * durable property: no Actions secret can take this suite red again, whether or
 * not anyone ever rotates it.
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
  if (envOverride) {
    const pinned = await resolvePinnedListing(request, photos, envOverride)
    if (pinned) return pinned
    // Pin is stale (deleted, unpublished, or no longer this shape) — falling through
    // to discovery is the whole reason discovery exists. An override that is trusted
    // blindly is exactly the 2026-08-15 failure mode with an extra step: the secret
    // rots and nobody notices until the suite reports it as a gallery regression.
  }

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

  const match = pickFixtureListing(items, photos)
  if (match) return { listingId: match, source: 'catalog' }

  return {
    listingId: null,
    source: 'unavailable',
    reason:
      `no public listing with ${DESCRIPTION[photos]} exists in the catalog ` +
      `(searched ${items.length})` +
      // Name the rejected pin. Without this line the skip reads "there is no such
      // listing" while a secret is quietly still set, and the next person to read
      // the log re-diagnoses the pin from scratch — which is how 2026-08-16 and
      // 2026-08-17 both produced a PR for the same defect.
      (envOverride ? `, and the pinned override ${envOverride} was checked and no longer qualifies` : '') +
      `. This spec cannot run until one does — that is a gap in the ` +
      `test DATA, not a passing test.`,
  }
}

/**
 * Checks a pinned override against the live catalog before trusting it: does the
 * listing still resolve, and does it still have the photo count the caller pinned
 * it for? Both questions matter — `MS_TEST_GALLERY_SINGLE_LISTING_ID` going 404 and
 * a seller adding a second photo to it are the same failure from the spec's point
 * of view (wrong fixture for this shape), so both fall back to discovery the same
 * way. A network failure here is treated as "the pin is unverifiable" rather than
 * an outage — discovery's own catalog fetch reports the outage state if the
 * catalog is genuinely down.
 */
async function resolvePinnedListing(
  request: APIRequestContext,
  photos: PhotoCount,
  id: string,
): Promise<GalleryFixture | null> {
  let response
  try {
    response = await request.get(`/api/ucp/catalog/${id}`)
  } catch {
    return null
  }
  if (!response.ok()) return null
  const listing = (await response.json()) as CatalogItem
  if (!MATCHES[photos]((listing.images ?? []).length)) return null
  return { listingId: id, source: 'env' }
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
