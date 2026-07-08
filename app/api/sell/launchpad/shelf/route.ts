/**
 * /api/sell/launchpad/shelf — the "Convocatoria" launchpad shelf
 * (bookshop-launchpad S2.2). Behind `launchpad.enabled`.
 *
 * GET  → the suggestion state for the card (does the shop have published works
 *        not yet gathered into a Convocatoria collection?).
 * POST → confirm: find-or-create the shop's "Convocatoria" collection and add
 *        every missing published launchpad work to it (union with each work's
 *        existing seller collections, so nothing is dropped).
 *
 * This is the FIRST product→collection membership-assignment path in the app —
 * OSPP S2 shipped collection CRUD + the backend `collection_ids` capability, but
 * no UI wrote memberships yet. Reuses that backend capability wholesale; adds no
 * new commerce primitive (AGENTS rule #1).
 */
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { isEnabled } from '@/lib/flags'
import {
  deriveShelfSuggestion,
  CONVOCATORIA_COLLECTION_NAME,
  type ShelfWork,
  type ShelfCollection,
} from '@/lib/launchpad-shelf'
import { shortCollectionSlug } from '@/lib/collection-derive'

export const dynamic = 'force-dynamic'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const PUB_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

function medusaFetch(path: string, clerkJwt: string, options?: RequestInit) {
  return fetch(`${MEDUSA_BASE}${path}`, {
    ...options,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'x-publishable-api-key': PUB_KEY,
      Authorization: `Bearer ${clerkJwt}`,
      ...(options?.headers ?? {}),
    },
  })
}

interface RawCollection { id: string; name: string; handle: string }
interface RawCategory { id: string }
interface RawProduct { id: string; status?: string; metadata?: Record<string, unknown> | null; categories?: RawCategory[] }

/** Read the shop's collections + published launchpad works, shaped for the pure
 *  deriver. A launchpad work is any product carrying the mint's provenance
 *  `metadata.launchpad_submission_id` (set by publishSubmission, S1.3). Returns
 *  null if either read fails (the caller degrades to "no suggestion"). */
async function loadShelfState(clerkJwt: string): Promise<{
  works: ShelfWork[]
  collections: ShelfCollection[]
  sellerSlug: string
} | null> {
  const [colRes, prodRes] = await Promise.all([
    medusaFetch('/store/sellers/me/collections', clerkJwt),
    medusaFetch('/store/sellers/me/products?limit=1000&offset=0', clerkJwt),
  ])
  if (!colRes.ok || !prodRes.ok) return null

  const collectionsRaw = ((await colRes.json())?.collections ?? []) as RawCollection[]
  const collections: ShelfCollection[] = collectionsRaw.map((c) => ({ id: c.id, name: c.name, handle: c.handle }))
  const collectionIdSet = new Set(collections.map((c) => c.id))

  const prodJson = (await prodRes.json()) as { products?: RawProduct[]; seller?: { slug?: string } }
  const products = prodJson.products ?? []
  const works: ShelfWork[] = products
    // A published launchpad work: carries the mint provenance AND is live
    // (status 'published'). Drafts/unactivated works aren't shelf-worthy yet —
    // the card copy says "obras publicadas" and a draft wouldn't show anyway.
    .filter((p) => !!(p.metadata ?? {})['launchpad_submission_id'] && p.status === 'published')
    .map((p) => ({
      productId: p.id,
      // Keep only the seller-collection categories (drop the platform-taxonomy
      // category), so the union we later PATCH is exactly the seller-owned set
      // that `collection_ids` governs.
      collectionIds: (p.categories ?? []).map((c) => c.id).filter((id) => collectionIdSet.has(id)),
    }))

  return { works, collections, sellerSlug: prodJson.seller?.slug ?? '' }
}

// ── GET — the suggestion state for the card ──────────────────────────────────
export async function GET() {
  const { userId, getToken } = await auth()
  if (!userId) return NextResponse.json({ suggest: false })
  if (!(await isEnabled('launchpad.enabled'))) return NextResponse.json({ suggest: false })

  const clerkJwt = await getToken()
  if (!clerkJwt) return NextResponse.json({ suggest: false })

  const state = await loadShelfState(clerkJwt)
  if (!state) return NextResponse.json({ suggest: false })

  const s = deriveShelfSuggestion(state.works, state.collections)
  const shortSlug = s.convocatoria ? shortCollectionSlug(s.convocatoria.handle, state.sellerSlug) : null
  return NextResponse.json({
    suggest: s.suggest,
    total_works: s.totalWorks,
    missing: s.missingWorkIds.length,
    collection_url: s.convocatoria && shortSlug ? `/s/${state.sellerSlug}/c/${shortSlug}` : null,
  })
}

// ── POST — confirm: create/assign the Convocatoria shelf ─────────────────────
export async function POST() {
  const { userId, getToken } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })
  if (!(await isEnabled('launchpad.enabled'))) return NextResponse.json({ error: 'No disponible.' }, { status: 423 })

  const clerkJwt = await getToken()
  if (!clerkJwt) return NextResponse.json({ error: 'Error de autenticación.' }, { status: 401 })

  const state = await loadShelfState(clerkJwt)
  if (!state) return NextResponse.json({ error: 'No se pudo cargar tu catálogo. Inténtalo de nuevo.' }, { status: 502 })

  const s = deriveShelfSuggestion(state.works, state.collections)
  if (!s.suggest) {
    // Nothing to shelve (no works, or all already shelved) — idempotent no-op.
    const shortSlug = s.convocatoria ? shortCollectionSlug(s.convocatoria.handle, state.sellerSlug) : null
    return NextResponse.json({
      ok: true,
      assigned: 0,
      collection_url: s.convocatoria && shortSlug ? `/s/${state.sellerSlug}/c/${shortSlug}` : null,
    })
  }

  // Find-or-create the "Convocatoria" collection.
  let convocatoria = s.convocatoria
  if (!convocatoria) {
    const createRes = await medusaFetch('/store/sellers/me/collections', clerkJwt, {
      method: 'POST',
      body: JSON.stringify({ name: CONVOCATORIA_COLLECTION_NAME }),
    })
    if (!createRes.ok) {
      const d = (await createRes.json().catch(() => ({}))) as { message?: string }
      return NextResponse.json({ error: d.message ?? 'No se pudo crear la colección.' }, { status: 502 })
    }
    const created = ((await createRes.json())?.collection ?? {}) as RawCollection
    if (!created.id) return NextResponse.json({ error: 'No se pudo crear la colección.' }, { status: 502 })
    convocatoria = { id: created.id, name: created.name, handle: created.handle }
  }

  // Assign each missing work: its existing seller collections UNION the shelf
  // (collection_ids is a full-replacement set — never drop an existing one).
  const worksById = new Map(state.works.map((w) => [w.productId, w]))
  let assigned = 0
  let failed = 0
  for (const wid of s.missingWorkIds) {
    const work = worksById.get(wid)
    const nextIds = Array.from(new Set([...(work?.collectionIds ?? []), convocatoria.id]))
    const patchRes = await medusaFetch(`/store/sellers/me/products/${wid}`, clerkJwt, {
      method: 'PATCH',
      body: JSON.stringify({ collection_ids: nextIds }),
    })
    if (patchRes.ok) assigned++
    else failed++
  }

  const shortSlug = shortCollectionSlug(convocatoria.handle, state.sellerSlug)
  // Report partial failures honestly — a silently-skipped PATCH would leave works
  // unshelved while the card claims success (a write nobody checks, LEARNINGS).
  return NextResponse.json({
    ok: failed === 0,
    assigned,
    failed,
    collection_id: convocatoria.id,
    collection_url: shortSlug ? `/s/${state.sellerSlug}/c/${shortSlug}` : null,
  })
}
