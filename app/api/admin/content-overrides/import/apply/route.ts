/**
 * Bulk copy-override import — APPLY (Clerk admin-gated via `withAdmin`, epic 08 ·
 * admin-content-and-announcements, Sprint 1). Writes the rows the client kept
 * after reviewing the preview diff from `POST /api/admin/content-overrides/import`.
 * Every row is RE-validated here (never trusts the client) via the same pure
 * `parseCopyOverrideWriteBody` the single-key save route uses — unknown keys are
 * rejected individually (not the whole batch), matching "the dictionary defines
 * the universe, an unknown key is skipped, never created."
 *
 *   POST /api/admin/content-overrides/import/apply
 *   body: { rows: Array<{ namespace, key, locale, value }> }
 */
import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { auth } from '@clerk/nextjs/server'
import { withAdmin } from '@/lib/admin/guard'
import { db } from '@/lib/supabase'
import { getDictionary } from '@/lib/dictionary'
import { flattenDictionary } from '@/lib/copy-tree'
import { parseCopyOverrideWriteBody } from '@/lib/copy-overrides-admin'
import { MAX_EXPORT_IMPORT_ROWS } from '@/lib/copy-overrides-import'

export const dynamic = 'force-dynamic'

export const POST = withAdmin(async (req: NextRequest) => {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }
  const { rows } = (body ?? {}) as { rows?: unknown }

  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'No hay filas para aplicar.' }, { status: 400 })
  }
  if (rows.length > MAX_EXPORT_IMPORT_ROWS) {
    return NextResponse.json({ error: `Demasiadas filas (máximo ${MAX_EXPORT_IMPORT_ROWS}).` }, { status: 400 })
  }

  const dict = await getDictionary('es')
  const knownPaths = new Set(flattenDictionary(dict).map((e) => `${e.namespace}.${e.key}`))
  const { userId } = await auth()

  const upsertRows: Array<{ namespace: string; key: string; locale: string; value: string; updated_at: string; updated_by: string | null }> = []
  const rejected: Array<{ namespace: unknown; key: unknown; error: string }> = []

  for (const raw of rows) {
    const parsed = parseCopyOverrideWriteBody(raw, knownPaths)
    if (!parsed.ok) {
      const r = (raw ?? {}) as { namespace?: unknown; key?: unknown }
      rejected.push({ namespace: r.namespace, key: r.key, error: parsed.error })
      continue
    }
    upsertRows.push({
      namespace: parsed.namespace,
      key: parsed.key,
      locale: parsed.locale,
      value: parsed.value,
      updated_at: new Date().toISOString(),
      updated_by: userId ?? null,
    })
  }

  let applied = 0
  if (upsertRows.length > 0) {
    const { error } = await db.from('platform_copy_overrides').upsert(upsertRows, { onConflict: 'namespace,key,locale' })
    if (error) return NextResponse.json({ error: 'No se pudo aplicar el import.' }, { status: 500 })
    applied = upsertRows.length
    revalidateTag('copy-overrides', 'default')
  }

  return NextResponse.json({ ok: true, applied, rejected })
})
