/**
 * Bulk copy-override export (Clerk admin-gated via `withAdmin`, epic 08 ·
 * admin-content-and-announcements, Sprint 1). Read-only — no audit needed (GET
 * isn't a mutation, matching `withAdmin`'s `isAuditedMethod`).
 *
 *   GET /api/admin/content-overrides/export?format=csv|xlsx|json&namespace=&section=
 *
 * `value` in every exported row is the CURRENT EFFECTIVE value (override if
 * present, else the compile-time default) — see `buildExportRows` for why.
 */
import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { withAdmin } from '@/lib/admin/guard'
import { db } from '@/lib/supabase'
import { getDictionary } from '@/lib/dictionary'
import { buildExportRows, rowsToCsv, rowsToSheetJson, rowsToJsonTree, type ImportScope } from '@/lib/copy-overrides-import'

export const dynamic = 'force-dynamic'

const FORMATS = ['csv', 'xlsx', 'json'] as const
type Format = (typeof FORMATS)[number]

function isFormat(value: string | null): value is Format {
  return value !== null && (FORMATS as readonly string[]).includes(value)
}

export const GET = withAdmin(async (req: NextRequest) => {
  const url = new URL(req.url)
  const format = url.searchParams.get('format')
  if (!isFormat(format)) {
    return NextResponse.json({ error: 'format debe ser csv, xlsx o json.' }, { status: 400 })
  }
  const scope: ImportScope = {
    namespace: url.searchParams.get('namespace') ?? undefined,
    section: url.searchParams.get('section') ?? undefined,
  }

  const [esDict, enDict, overridesResult] = await Promise.all([
    getDictionary('es'),
    getDictionary('en'),
    db.from('platform_copy_overrides').select('namespace, key, locale, value'),
  ])
  if (overridesResult.error) {
    return NextResponse.json({ error: 'No se pudieron leer los overrides.' }, { status: 500 })
  }

  const rows = buildExportRows(esDict, enDict, overridesResult.data ?? [], scope)
  const filenameBase = `contenido${scope.namespace ? `-${scope.namespace}` : ''}${scope.section ? `-${scope.section}` : ''}`

  if (format === 'csv') {
    return new NextResponse(rowsToCsv(rows), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filenameBase}.csv"`,
      },
    })
  }

  if (format === 'json') {
    return new NextResponse(JSON.stringify(rowsToJsonTree(rows), null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filenameBase}.json"`,
      },
    })
  }

  const sheet = XLSX.utils.json_to_sheet(rowsToSheetJson(rows))
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'contenido')
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filenameBase}.xlsx"`,
    },
  })
})
