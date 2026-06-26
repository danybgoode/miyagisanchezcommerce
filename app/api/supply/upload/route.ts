/**
 * Supply image upload — admin-gated sibling of /api/sell/upload for the
 * supply/import pipeline (Gem → Claimable Shop Loop · S1.3). Turns a local photo
 * into a hosted URL for staging a gem (or attaching to a listing after import).
 *
 *   POST /api/supply/upload   multipart form-data: file=<image>
 *   Auth: Clerk admin session OR shared ADMIN_SECRET (via withSupplyAdmin) —
 *   the headless importer has no Clerk login, so the secret path is required.
 *   → { url }
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { withSupplyAdmin } from '@/lib/admin/guard'
import { uploadToR2, isR2Configured } from '@/lib/r2'

const BUCKET = 'listing-images'
const MAX_SIZE_BYTES = 8 * 1024 * 1024 // 8 MB hard cap, same as /api/sell/upload
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'])

export const POST = withSupplyAdmin(async (req: NextRequest) => {
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
  const path = `listing-images/supply/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const bytes = await file.arrayBuffer()

  // ── R2 (preferred) with Supabase fallback — same ladder as /api/sell/upload ─
  if (isR2Configured()) {
    try {
      const url = await uploadToR2(bytes, path, file.type)
      return NextResponse.json({ url })
    } catch (e) {
      console.error('[supply/upload] R2 failed, falling back to Supabase:', e)
    }
  }

  const supabasePath = `supply/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  await db.storage.createBucket(BUCKET, { public: true }).catch(() => {})

  const { error: uploadError } = await db.storage
    .from(BUCKET)
    .upload(supabasePath, bytes, { contentType: file.type, upsert: false })

  if (uploadError) {
    console.error('[supply/upload] Supabase Storage upload error:', uploadError)
    return NextResponse.json({ error: 'Error al subir la imagen. Inténtalo de nuevo.' }, { status: 500 })
  }

  const { data: { publicUrl } } = db.storage.from(BUCKET).getPublicUrl(supabasePath)
  return NextResponse.json({ url: publicUrl })
})
