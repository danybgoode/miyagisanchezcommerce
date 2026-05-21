import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'

const BUCKET = 'digital-files'
const MAX_SIZE_BYTES = 100 * 1024 * 1024 // 100 MB

const ALLOWED_MIME = new Set([
  // Documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // Archives
  'application/zip',
  'application/x-zip-compressed',
  'application/x-rar-compressed',
  'application/x-7z-compressed',
  'application/x-tar',
  'application/gzip',
  // Audio
  'audio/mpeg', 'audio/wav', 'audio/flac', 'audio/ogg', 'audio/aac',
  // Video
  'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm',
  // Images (design files)
  'image/svg+xml', 'image/png', 'image/jpeg', 'image/webp',
  // Code/text
  'text/plain', 'text/csv', 'application/json',
  // E-books
  'application/epub+zip',
])

const MIME_LABEL: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/zip': 'ZIP', 'application/x-zip-compressed': 'ZIP',
  'application/x-rar-compressed': 'RAR', 'application/x-7z-compressed': '7Z',
  'audio/mpeg': 'MP3', 'audio/wav': 'WAV', 'audio/flac': 'FLAC',
  'video/mp4': 'MP4', 'video/quicktime': 'MOV',
  'text/plain': 'TXT', 'text/csv': 'CSV', 'application/json': 'JSON',
  'application/epub+zip': 'EPUB',
}

function getLabel(mime: string): string {
  return MIME_LABEL[mime] ?? mime.split('/')[1]?.toUpperCase() ?? 'FILE'
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'No autenticado. Inicia sesión para subir archivos.' }, { status: 401 })
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
      error: `El archivo es demasiado grande (${(file.size / 1024 / 1024).toFixed(1)} MB). El máximo es 100 MB.`,
    }, { status: 400 })
  }

  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json({
      error: 'Formato no soportado. Sube PDF, ZIP, MP3, MP4, EPUB u otros formatos digitales.',
    }, { status: 400 })
  }

  const ext = (file.name.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '')
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}_${safeName}.${ext}`

  const bytes = await file.arrayBuffer()

  // Create private bucket (idempotent) — NOT public
  await db.storage.createBucket(BUCKET, { public: false }).catch(() => {})

  const { error: uploadError } = await db.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: file.type, upsert: false })

  if (uploadError) {
    console.error('Digital file upload error:', uploadError)
    return NextResponse.json({ error: 'Error al subir el archivo. Inténtalo de nuevo.' }, { status: 500 })
  }

  return NextResponse.json({
    path,                       // stored path for generating signed URLs later
    name: file.name,
    size: file.size,
    mime: file.type,
    label: getLabel(file.type), // human-readable format label
  })
}
