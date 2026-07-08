import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { uploadToR2, isR2Configured } from '@/lib/r2'

// cars-vertical S2.1 — autos inspection-report PDF upload. Public bucket (not
// the private digital-goods bucket): buyers must open the report from the PDP
// with zero extra step ("no dead ends" — no signed-URL gating needed for
// non-sensitive trust content, same tier as listing photos).
const BUCKET = 'listing-images'
const MAX_SIZE_BYTES = 15 * 1024 * 1024 // 15 MB (a scanned multi-point report is bigger than a compressed photo)
const ALLOWED_MIME = new Set(['application/pdf'])

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'No autenticado. Inicia sesión para subir el reporte.' }, { status: 401 })
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
      error: `El archivo es demasiado grande (${(file.size / 1024 / 1024).toFixed(1)} MB). El máximo es 15 MB.`,
    }, { status: 400 })
  }

  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json({
      error: 'Formato no soportado. Sube el reporte de inspección en PDF.',
    }, { status: 400 })
  }

  const path = `inspection-reports/${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`
  const bytes = await file.arrayBuffer()

  // ── R2 (preferred) with Supabase fallback ──────────────────────────────────
  if (isR2Configured()) {
    try {
      const url = await uploadToR2(bytes, path, file.type)
      return NextResponse.json({ url })
    } catch (e) {
      console.error('[inspection-upload] R2 failed, falling back to Supabase:', e)
      // Fall through to Supabase
    }
  }

  // ── Supabase Storage fallback ──────────────────────────────────────────────
  const supabasePath = `inspection-reports/${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`
  await db.storage.createBucket(BUCKET, { public: true }).catch(() => {})

  const { error: uploadError } = await db.storage
    .from(BUCKET)
    .upload(supabasePath, bytes, { contentType: file.type, upsert: false })

  if (uploadError) {
    console.error('Supabase Storage upload error:', uploadError)
    return NextResponse.json({ error: 'Error al subir el reporte. Inténtalo de nuevo.' }, { status: 500 })
  }

  const { data: { publicUrl } } = db.storage.from(BUCKET).getPublicUrl(supabasePath)
  return NextResponse.json({ url: publicUrl })
}
