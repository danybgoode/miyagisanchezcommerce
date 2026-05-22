/**
 * PATCH /api/sell/content/[id]  — update a content post
 * DELETE /api/sell/content/[id] — delete a content post
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'

async function getShopId(userId: string): Promise<string | null> {
  const { data } = await db
    .from('marketplace_shops')
    .select('id')
    .eq('clerk_user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return data?.id ?? null
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const { id } = await params
  const shopId = await getShopId(userId)
  if (!shopId) return NextResponse.json({ error: 'Tienda no encontrada.' }, { status: 404 })

  let body: {
    title?: string
    body?: string | null
    file_url?: string | null
    file_type?: string | null
    is_published?: boolean
  }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }

  const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.title !== undefined) {
    const t = body.title.trim()
    if (t.length < 2 || t.length > 200) {
      return NextResponse.json({ error: 'Título inválido.' }, { status: 422 })
    }
    updatePayload.title = t
  }
  if (body.body !== undefined) updatePayload.body = body.body?.trim() ?? null
  if (body.file_url !== undefined) updatePayload.file_url = body.file_url
  if (body.file_type !== undefined) updatePayload.file_type = body.file_type
  if (body.is_published !== undefined) updatePayload.is_published = body.is_published

  const { error } = await db
    .from('marketplace_subscription_content')
    .update(updatePayload)
    .eq('id', id)
    .eq('shop_id', shopId)  // ownership check

  if (error) {
    console.error('[content PATCH]', error)
    return NextResponse.json({ error: 'Error al actualizar.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const { id } = await params
  const shopId = await getShopId(userId)
  if (!shopId) return NextResponse.json({ error: 'Tienda no encontrada.' }, { status: 404 })

  const { error } = await db
    .from('marketplace_subscription_content')
    .delete()
    .eq('id', id)
    .eq('shop_id', shopId)  // ownership check

  if (error) {
    console.error('[content DELETE]', error)
    return NextResponse.json({ error: 'Error al eliminar.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
