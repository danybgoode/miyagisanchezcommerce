import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { uploadToR2, isR2Configured } from '@/lib/r2'

const BUCKET = 'listing-images'
const MAX_SIZE_BYTES = 8 * 1024 * 1024 // 8 MB (client compresses first, this is a hard cap)
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'])

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'No autenticado. Inicia sesión para subir fotos.' }, { status: 401 })
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'No se pudo leer el archivo.' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  if (!file || file.size === 0) {
    return NextResponse.json({ error: 'No se recibió ningún archivo.' }, { status: 400 })
  }

  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({
      error: `La foto es demasiado grande (${(file.size / 1024 / 1024).toFixed(1)} MB). El máximo es 8 MB.`,
    }, { status: 400 })
  }

  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json({
      error: 'Formato no soportado. Usa JPG, PNG, WEBP o GIF.',
    }, { status: 400 })
  }

  const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')
  const path = `listing-images/${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const bytes = await file.arrayBuffer()

  // ── R2 (preferred) with Supabase fallback ──────────────────────────────────
  if (isR2Configured()) {
    try {
      const url = await uploadToR2(bytes, path, file.type)
      return NextResponse.json({ url })
    } catch (e) {
      console.error('[upload] R2 failed, falling back to Supabase:', e)
      // Fall through to Supabase
    }
  }

  // ── Supabase Storage fallback ──────────────────────────────────────────────
  const supabasePath = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  await db.storage.createBucket(BUCKET, { public: true }).catch(() => {})

  const { error: uploadError } = await db.storage
    .from(BUCKET)
    .upload(supabasePath, bytes, { contentType: file.type, upsert: false })

  if (uploadError) {
    console.error('Supabase Storage upload error:', uploadError)
    return NextResponse.json({ error: 'Error al subir la imagen. Inténtalo de nuevo.' }, { status: 500 })
  }

  const { data: { publicUrl } } = db.storage.from(BUCKET).getPublicUrl(supabasePath)
  return NextResponse.json({ url: publicUrl })
}
