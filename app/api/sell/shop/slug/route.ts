/**
 * PATCH /api/sell/shop/slug — change the shop's slug (its /s/[slug] address).
 *
 * Slug is authoritative in Medusa (seller.slug, unique). We:
 *  1. validate format/reserved (the backend re-checks + owns uniqueness → 409),
 *  2. PATCH Medusa with the new slug AND a `previous_slugs` record so the old slug
 *     301-redirects for 90 days (US-4); `previous_slug_keys` is the flat,
 *     queryable mirror of the active old slugs the redirect lookup uses,
 *  3. mirror slug + metadata to Supabase (the routing/redirect hot path),
 *  4. bust caches so the storefront + redirect map update immediately.
 */

import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { validateSlug } from '@/lib/slug'
import { SLUG_REDIRECT_TAG } from '@/lib/slug-redirect'
import { registerShopSubdomain } from '@/lib/vercel-domains'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const PUB_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000
const MAX_PREVIOUS_SLUGS = 10

type PreviousSlug = { slug: string; until: string }

function medusaFetch(path: string, clerkJwt: string, options?: RequestInit) {
  return fetch(`${MEDUSA_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-publishable-api-key': PUB_KEY,
      Authorization: `Bearer ${clerkJwt}`,
      ...(options?.headers ?? {}),
    },
  })
}

export async function PATCH(req: NextRequest) {
  const { userId, getToken } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  let body: { slug?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }

  const newSlug = body.slug?.trim().toLowerCase() ?? ''
  const check = validateSlug(newSlug)
  if (!check.valid) return NextResponse.json({ error: check.reason, field: 'slug' }, { status: 422 })

  const clerkJwt = await getToken()
  if (!clerkJwt) return NextResponse.json({ error: 'Error de autenticación.' }, { status: 401 })

  // Current shop (mirror) — gives the old slug + existing alias history.
  const { data: shop } = await db
    .from('marketplace_shops')
    .select('id, slug, metadata')
    .eq('clerk_user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!shop) return NextResponse.json({ error: 'Tienda no encontrada.' }, { status: 404 })

  const oldSlug = (shop as { slug: string }).slug
  if (oldSlug === newSlug) return NextResponse.json({ slug: newSlug }) // no-op

  // Build the new alias history: keep non-expired entries, drop any equal to the
  // new slug (it's live again), add the old slug, cap the list.
  const meta = ((shop as { metadata: Record<string, unknown> | null }).metadata ?? {}) as Record<string, unknown>
  const now = Date.now()
  const existing = (Array.isArray(meta.previous_slugs) ? meta.previous_slugs : []) as PreviousSlug[]
  const kept = existing.filter(p => p?.slug && p.slug !== newSlug && new Date(p.until).getTime() > now)
  const previousSlugs: PreviousSlug[] = [
    ...kept,
    { slug: oldSlug, until: new Date(now + NINETY_DAYS_MS).toISOString() },
  ].slice(-MAX_PREVIOUS_SLUGS)
  const previousSlugKeys = previousSlugs.map(p => p.slug)

  // 1) Authoritative write to Medusa (slug + metadata). Backend owns uniqueness.
  const patchRes = await medusaFetch('/store/sellers/me', clerkJwt, {
    method: 'PATCH',
    body: JSON.stringify({
      slug: newSlug,
      metadata: { previous_slugs: previousSlugs, previous_slug_keys: previousSlugKeys },
    }),
  })
  if (!patchRes.ok) {
    const err = await patchRes.json().catch(() => ({})) as { message?: string }
    if (patchRes.status === 409) {
      return NextResponse.json({ error: err.message ?? 'Ese slug ya está en uso.', field: 'slug' }, { status: 409 })
    }
    if (patchRes.status === 422) {
      return NextResponse.json({ error: err.message ?? 'Slug inválido.', field: 'slug' }, { status: 422 })
    }
    console.error('[sell/shop/slug] Medusa PATCH failed:', patchRes.status, err)
    return NextResponse.json({ error: 'No se pudo cambiar el slug.' }, { status: 502 })
  }

  // 2) Mirror to Supabase (routing + redirect hot path).
  await db
    .from('marketplace_shops')
    .update({
      slug: newSlug,
      metadata: { ...meta, previous_slugs: previousSlugs, previous_slug_keys: previousSlugKeys },
      updated_at: new Date().toISOString(),
    })
    .eq('id', (shop as { id: string }).id)

  // 3) Register the new subdomain (slug.miyagisanchez.com). Best-effort; the old
  //    subdomain is left registered so it keeps serving the 90-day 301.
  await registerShopSubdomain(newSlug)

  // 4) Bust caches so the storefront + alias redirect reflect the change now.
  revalidateTag('listings', 'default')
  revalidateTag('shops', 'default')
  revalidateTag(SLUG_REDIRECT_TAG, 'default')

  return NextResponse.json({ slug: newSlug, previous_slug: oldSlug })
}
