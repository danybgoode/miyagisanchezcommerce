import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { revalidateTag } from 'next/cache'
import { validateWallEntryCreate } from '@/lib/wall/validate'
import { referenceBelongsToShop } from '@/lib/wall/resolve'
import { resolveOwnShop, listOwnWallEntries, createWallEntry } from '@/lib/wall/store'

/**
 * Living Shop — the seller's own Wall (epic 07, Story 1.2).
 *
 * GET  /api/sell/wall   → this seller's entries, every status.
 * POST /api/sell/wall   → create one.
 *
 * The shop is resolved from the Clerk session (epic D2). The body may not name a
 * shop, and there is no code path here that would read one — `resolveOwnShop`
 * takes a user id, not a shop id.
 */

export const dynamic = 'force-dynamic'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const shop = await resolveOwnShop(userId)
  if (!shop) return NextResponse.json({ error: 'Aún no tienes una tienda.' }, { status: 404 })

  const entries = await listOwnWallEntries(shop.id)
  return NextResponse.json({ entries, shop: { slug: shop.slug, name: shop.name } })
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const shop = await resolveOwnShop(userId)
  if (!shop) return NextResponse.json({ error: 'Aún no tienes una tienda.' }, { status: 404 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }

  const validation = validateWallEntryCreate((body ?? {}) as Record<string, unknown>)
  if (!validation.ok) {
    return NextResponse.json({ error: validation.issues[0].message, issues: validation.issues }, { status: 422 })
  }

  // Ownership, checked against the SAME identifier the public renderer will
  // resolve (epic D3). Shape validity is not permission.
  const owns = await referenceBelongsToShop(validation.value.kind, validation.value.reference_id, shop)
  if (!owns) {
    return NextResponse.json(
      { error: 'Ese producto, colección o evento no es de tu tienda.', field: 'reference_id' },
      { status: 403 },
    )
  }

  const entry = await createWallEntry(shop, userId, validation.value)
  // The public Wall reads through the `listings` cache tag alongside the shop's
  // catalog, so a publish is visible immediately rather than up to 120s later.
  revalidateTag('listings', 'default')
  return NextResponse.json({ entry }, { status: 201 })
}
