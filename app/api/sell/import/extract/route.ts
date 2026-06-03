import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'
import {
  buildExtractionPrompt,
  validateRows,
  EXTRACT_CHAR_LIMIT,
  MAX_IMPORT_ROWS,
} from '@/lib/catalog-import'

/**
 * POST /api/sell/import/extract
 *
 * On-site "paste & publish" (Sprint 2): takes a seller's raw text, asks Gemini
 * Flash to extract a structured catalog (JSON), then runs it through the same
 * validator as the file uploader so the result drops into the shared staging
 * grid. The LLM only needs to produce a roughly-correct array — our validator
 * coerces and flags the rest.
 */

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.5-flash'
const GEMINI_KEY = process.env.GEMINI_API_KEY ?? ''

/** Pull the first JSON array out of a model response (handles ```json fences,
 *  stray prose, or a single object). Returns [] on failure. */
function extractJsonArray(text: string): unknown[] {
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```/g, '').trim()
  try {
    const parsed = JSON.parse(cleaned)
    if (Array.isArray(parsed)) return parsed
    if (parsed && typeof parsed === 'object') return [parsed]
  } catch {
    // fall through to bracket extraction
  }
  const start = cleaned.indexOf('[')
  const end = cleaned.lastIndexOf(']')
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1))
      if (Array.isArray(parsed)) return parsed
    } catch {
      // give up
    }
  }
  return []
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  if (!GEMINI_KEY) {
    return NextResponse.json(
      { error: 'La extracción con IA aún no está configurada. Usa la opción de subir un archivo por ahora.' },
      { status: 503 },
    )
  }

  // Rate limit — each call hits a paid LLM.
  const rl = await checkRateLimit('catalog_extract', `${userId}:${getClientIp(req)}`)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Demasiados intentos. Espera ${Math.ceil(rl.retryAfter / 60)} min e inténtalo de nuevo.` },
      { status: 429 },
    )
  }

  let body: { text?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }

  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) return NextResponse.json({ error: 'Pega algún texto para extraer.' }, { status: 422 })
  if (text.length > EXTRACT_CHAR_LIMIT) {
    return NextResponse.json(
      { error: `El texto supera el límite de ${EXTRACT_CHAR_LIMIT.toLocaleString('es-MX')} caracteres. Usa la opción de archivo con tu propia IA.` },
      { status: 422 },
    )
  }

  // User text is isolated in tags; the system prompt instructs the model to
  // treat everything inside them as data, never instructions.
  const prompt = `${buildExtractionPrompt()}\n\n<datos_del_vendedor>\n${text}\n</datos_del_vendedor>`

  let modelText: string
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
        }),
      },
    )
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      console.error('[import/extract] Gemini error', res.status, detail.slice(0, 500))
      return NextResponse.json({ error: 'La IA no pudo procesar el texto. Inténtalo de nuevo en un momento.' }, { status: 502 })
    }
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    modelText = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
  } catch (e) {
    console.error('[import/extract] Gemini fetch failed', e)
    return NextResponse.json({ error: 'No se pudo contactar al servicio de IA. Inténtalo de nuevo.' }, { status: 502 })
  }

  const rows = extractJsonArray(modelText).slice(0, MAX_IMPORT_ROWS)
  if (rows.length === 0) {
    return NextResponse.json(
      { error: 'No pudimos identificar productos en el texto. Intenta agregar más detalle (nombre, precio, categoría).' },
      { status: 422 },
    )
  }

  const staged = validateRows(rows)
  return NextResponse.json({ staged, fileErrors: [] })
}
