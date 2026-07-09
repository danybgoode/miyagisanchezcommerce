/**
 * Bulk copy-override import — PREVIEW only (Clerk admin-gated via `withAdmin`,
 * epic 08 · admin-content-and-announcements, Sprint 1). Parses an uploaded
 * CSV/XLSX/JSON file and diffs it against the current override state; NEVER
 * writes. The client reviews the diff, then POSTs the rows it wants to keep to
 * `POST /api/admin/content-overrides/import/apply`.
 *
 *   POST /api/admin/content-overrides/import
 *   body: { format: 'csv'|'xlsx'|'json', content: string }
 *         (content is raw text for csv/json, base64 for xlsx)
 */
import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { withAdmin } from '@/lib/admin/guard'
import { db } from '@/lib/supabase'
import { getDictionary } from '@/lib/dictionary'
import {
  csvToImportedRows,
  sheetJsonToImportedRows,
  jsonTreeToImportedRows,
  diffImport,
  buildDefaultsMap,
  MAX_EXPORT_IMPORT_ROWS,
  type ImportedRow,
} from '@/lib/copy-overrides-import'

export const dynamic = 'force-dynamic'

const FORMATS = ['csv', 'xlsx', 'json'] as const
type Format = (typeof FORMATS)[number]

// Bounds the raw upload BEFORE any parsing (CSV/JSON.parse/XLSX.read) runs, so a
// pathologically large paste/file can't burn CPU/memory before the row-count cap
// (MAX_EXPORT_IMPORT_ROWS) ever gets a chance to reject it. Generous relative to
// a real spreadsheet of copy strings (2000 rows of short text is a few hundred
// KB even as XLSX base64) but bounded — this is a Clerk-admin-gated surface, not
// public, so this is defense in depth rather than the primary guard.
const MAX_CONTENT_CHARS = 10_000_000

function isFormat(value: unknown): value is Format {
  return typeof value === 'string' && (FORMATS as readonly string[]).includes(value)
}

export const POST = withAdmin(async (req: NextRequest) => {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }
  const { format, content } = (body ?? {}) as { format?: unknown; content?: unknown }

  if (!isFormat(format)) return NextResponse.json({ error: 'format debe ser csv, xlsx o json.' }, { status: 400 })
  if (typeof content !== 'string' || content.length === 0) {
    return NextResponse.json({ error: 'Archivo vacío o inválido.' }, { status: 400 })
  }
  if (content.length > MAX_CONTENT_CHARS) {
    return NextResponse.json({ error: 'El archivo es demasiado grande.' }, { status: 413 })
  }

  let imported: ImportedRow[]
  try {
    if (format === 'csv') {
      imported = csvToImportedRows(content)
    } else if (format === 'json') {
      imported = jsonTreeToImportedRows(JSON.parse(content))
    } else {
      const workbook = XLSX.read(Buffer.from(content, 'base64'), { type: 'buffer' })
      const sheetName = workbook.SheetNames[0]
      const sheet = sheetName ? XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]) : []
      imported = sheetJsonToImportedRows(sheet as Record<string, unknown>[])
    }
  } catch {
    return NextResponse.json({ error: 'No se pudo leer el archivo.' }, { status: 400 })
  }

  if (imported.length === 0) {
    return NextResponse.json({ error: 'El archivo no tiene filas válidas (o le faltan las columnas namespace/key/locale/value).' }, { status: 400 })
  }
  if (imported.length > MAX_EXPORT_IMPORT_ROWS) {
    return NextResponse.json({ error: `El archivo tiene demasiadas filas (máximo ${MAX_EXPORT_IMPORT_ROWS}).` }, { status: 400 })
  }

  const [esDict, enDict, overridesResult] = await Promise.all([
    getDictionary('es'),
    getDictionary('en'),
    db.from('platform_copy_overrides').select('namespace, key, locale, value'),
  ])
  if (overridesResult.error) {
    return NextResponse.json({ error: 'No se pudieron leer los overrides actuales.' }, { status: 500 })
  }

  const defaults = buildDefaultsMap(esDict, enDict)
  const diff = diffImport(imported, overridesResult.data ?? [], defaults)

  return NextResponse.json({ diff })
})
