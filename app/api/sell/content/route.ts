/**
 * GET  /api/sell/content   — list seller's content posts (with optional listing_id filter)
 * POST /api/sell/content   — create a new content post
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  // Get seller's shop
  const { data: shop } = await db
    .from('marketplace_shops')
    .select('id')
    .eq('clerk_user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!shop) return NextResponse.json({ content: [] })

  const { searchParams } = new URL(req.url)
  const listingId = searchParams.get('listing_id')

  let query = db
    .from('marketplace_subscription_content')
    .select('id, listing_id, title, body, file_url, file_type, is_published, created_at, updated_at')
    .eq('shop_id', shop.id)
    .order('created_at', { ascending: false })
    .limit(100)

  if (listingId) query = query.eq('listing_id', listingId)

  const { data: content, error } = await query

  if (error) {
    console.error('[content GET]', error)
    return NextResponse.json({ error: 'Error al obtener contenido.' }, { status: 500 })
  }

  return NextResponse.json({ content: content ?? [] })
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  let body: {
    listing_id?: string | null
    title: string
    body?: string | null
    file_url?: string | null
    file_type?: string | null
    is_published?: boolean
  }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }

  const titleClean = body.title?.trim() ?? ''
  if (titleClean.length < 2) {
    return NextResponse.json({ error: 'El título debe tener al menos 2 caracteres.', field: 'title' }, { status: 422 })
  }
  if (titleClean.length > 200) {
    return NextResponse.json({ error: 'El título no puede superar los 200 caracteres.', field: 'title' }, { status: 422 })
  }

  // Get seller's shop
  const { data: shop } = await db
    .from('marketplace_shops')
    .select('id')
    .eq('clerk_user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!shop) return NextResponse.json({ error: 'No encontramos tu tienda.' }, { status: 422 })

  // Verify listing belongs to shop (if provided)
  if (body.listing_id) {
    const { data: listing } = await db
      .from('marketplace_listings')
      .select('id')
      .eq('id', body.listing_id)
      .eq('shop_id', shop.id)
      .maybeSingle()

    if (!listing) {
      return NextResponse.json({ error: 'Anuncio no encontrado.' }, { status: 404 })
    }
  }

  const { data: content, error } = await db
    .from('marketplace_subscription_content')
    .insert({
      shop_id: shop.id,
      listing_id: body.listing_id ?? null,
      title: titleClean,
      body: body.body?.trim() ?? null,
      file_url: body.file_url ?? null,
      file_type: body.file_type ?? null,
      is_published: body.is_published ?? true,
    })
    .select('id')
    .single()

  if (error || !content) {
    console.error('[content POST]', error)
    return NextResponse.json({ error: 'Error al crear el contenido.' }, { status: 500 })
  }

  return NextResponse.json({ contentId: content.id }, { status: 201 })
}
