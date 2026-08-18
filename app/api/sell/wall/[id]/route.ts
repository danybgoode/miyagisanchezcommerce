import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { revalidateTag } from 'next/cache'
import { validateWallEntryUpdate } from '@/lib/wall/validate'
import { referenceBelongsToShop } from '@/lib/wall/resolve'
import { resolveOwnShop, getOwnWallEntry, updateWallEntry, deleteWallEntry } from '@/lib/wall/store'

/**
 * Living Shop — one Wall entry (epic 07, Story 1.2).
 *
 * PATCH  /api/sell/wall/[id]  → edit, publish, unpublish, schedule, pin.
 * DELETE /api/sell/wall/[id]  → remove.
 *
 * `getOwnWallEntry` puts the shop id in the WHERE clause rather than reading the
 * row and checking ownership afterwards, so a foreign entry 404s instead of
 * relying on an `if` a later refactor could drop.
 */

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const shop = await resolveOwnShop(userId)
  if (!shop) return NextResponse.json({ error: 'Aún no tienes una tienda.' }, { status: 404 })

  const existing = await getOwnWallEntry(shop.id, id)
  if (!existing) return NextResponse.json({ error: 'Publicación no encontrada.' }, { status: 404 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }

  // The WHOLE resulting entry is validated, not just the patch — a status flip
  // that would strand a `scheduled_for` has to fail, and it only can if the
  // merged shape is what gets checked.
  const validation = validateWallEntryUpdate(existing, (body ?? {}) as Record<string, unknown>)
  if (!validation.ok) {
    return NextResponse.json({ error: validation.issues[0].message, issues: validation.issues }, { status: 422 })
  }

  // Re-checked on every edit, not only on create: a product can leave the shop
  // between the two writes, and an entry that was legitimate yesterday is a
  // cross-shop reference today.
  const owns = await referenceBelongsToShop(validation.value.kind, validation.value.reference_id, shop)
  if (!owns) {
    return NextResponse.json(
      { error: 'Ese producto, colección o evento no es de tu tienda.', field: 'reference_id' },
      { status: 403 },
    )
  }

  const outcome = await updateWallEntry(shop, existing, validation.value)
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status })

  revalidateTag('listings', 'default')
  return NextResponse.json({ entry: outcome.entry })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const shop = await resolveOwnShop(userId)
  if (!shop) return NextResponse.json({ error: 'Aún no tienes una tienda.' }, { status: 404 })

  const removed = await deleteWallEntry(shop.id, id)
  if (!removed) return NextResponse.json({ error: 'Publicación no encontrada.' }, { status: 404 })

  revalidateTag('listings', 'default')
  return NextResponse.json({ ok: true })
}
