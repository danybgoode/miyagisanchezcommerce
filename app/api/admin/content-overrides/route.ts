/**
 * Admin runtime copy-override control (Clerk admin-gated via `withAdmin`, epic 08 ·
 * admin-content-and-announcements, Sprint 1). Writes the OWNED `platform_copy_overrides`
 * Supabase table that `lib/copy-overrides.ts` reads through `getOverriddenDictionary()`.
 *
 *   GET    /api/admin/content-overrides — list every override row
 *   POST   /api/admin/content-overrides — upsert one { namespace, key, locale, value }
 *   DELETE /api/admin/content-overrides — restore (delete) one { namespace, key, locale }
 *
 * `withAdmin` 401s any non-admin BEFORE the handler runs and writes a best-effort
 * `admin_audit_log` row on each successful mutation — so every save/restore is
 * audited with no manual audit call here. Every write calls `revalidateTag('copy-overrides')`
 * so the edit is live immediately rather than waiting out the 60s cache window.
 */
import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { auth } from '@clerk/nextjs/server'
import { withAdmin } from '@/lib/admin/guard'
import { db } from '@/lib/supabase'
import { getDictionary } from '@/lib/dictionary'
import { flattenDictionary } from '@/lib/copy-tree'
import { parseCopyOverrideWriteBody, parseCopyOverrideDeleteBody } from '@/lib/copy-overrides-admin'
import { classifyOverrideStoreError, OVERRIDE_STORE_UNAVAILABLE_MESSAGE } from '@/lib/copy-overrides-errors'

export const dynamic = 'force-dynamic'

const TABLE = 'platform_copy_overrides'

/** The set of `namespace.key` paths that actually exist — "the dictionary defines the universe." */
async function knownPaths(): Promise<Set<string>> {
  const dict = await getDictionary('es')
  return new Set(flattenDictionary(dict).map((e) => `${e.namespace}.${e.key}`))
}

/**
 * Shared error response: a missing/unreachable table gets a distinct 503 +
 * actionable es-MX message (Story 1.2) instead of the same generic 500 every
 * other failure returns — the exact ambiguity that hid the Story 1.1 gap for
 * two days.
 */
function storeErrorResponse(error: unknown, genericMessage: string) {
  if (classifyOverrideStoreError(error) === 'store_unavailable') {
    return NextResponse.json({ error: OVERRIDE_STORE_UNAVAILABLE_MESSAGE, code: 'store_unavailable' }, { status: 503 })
  }
  return NextResponse.json({ error: genericMessage }, { status: 500 })
}

export const GET = withAdmin(async () => {
  const { data, error } = await db
    .from(TABLE)
    .select('namespace, key, locale, value, updated_at, updated_by')
  if (error) return storeErrorResponse(error, 'No se pudieron leer los overrides.')
  return NextResponse.json({ overrides: data ?? [] })
})

export const POST = withAdmin(async (req: NextRequest) => {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }

  const parsed = parseCopyOverrideWriteBody(body, await knownPaths())
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const { userId } = await auth()

  const { error } = await db.from(TABLE).upsert(
    {
      namespace: parsed.namespace,
      key: parsed.key,
      locale: parsed.locale,
      value: parsed.value,
      updated_at: new Date().toISOString(),
      updated_by: userId ?? null,
    },
    { onConflict: 'namespace,key,locale' },
  )
  if (error) return storeErrorResponse(error, 'No se pudo guardar el override.')

  revalidateTag('copy-overrides', 'default')
  return NextResponse.json({ ok: true, namespace: parsed.namespace, key: parsed.key, locale: parsed.locale, value: parsed.value })
})

export const DELETE = withAdmin(async (req: NextRequest) => {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }

  const parsed = parseCopyOverrideDeleteBody(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const { error } = await db
    .from(TABLE)
    .delete()
    .eq('namespace', parsed.namespace)
    .eq('key', parsed.key)
    .eq('locale', parsed.locale)
  if (error) return storeErrorResponse(error, 'No se pudo restaurar.')

  revalidateTag('copy-overrides', 'default')
  return NextResponse.json({ ok: true })
})
