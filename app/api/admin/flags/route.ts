/**
 * Admin feature-flag control (Clerk admin-gated via `withAdmin`, epic 09 ·
 * feature-flags-inhouse, Sprint 2). Writes the OWNED `platform_flags` Supabase table
 * that `lib/flags.ts` reads through the unchanged `isEnabled()` seam — a flip takes
 * effect in both apps within one cache TTL (~60 s), no redeploy.
 *
 *   GET  /api/admin/flags   — list every platform_flags row
 *   POST /api/admin/flags   — upsert { key, enabled } for one known flag
 *
 * `withAdmin` 401s any non-admin BEFORE the handler runs (order = flag→auth→validate,
 * per LEARNINGS) and writes a best-effort `admin_audit_log` row on each successful POST —
 * so every flip is audited with no manual audit call here.
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { withAdmin } from '@/lib/admin/guard'
import { db } from '@/lib/supabase'
import { parseFlagWriteBody, FLAG_META } from '@/lib/flags-admin'

export const dynamic = 'force-dynamic'

export const GET = withAdmin(async () => {
  const { data, error } = await db
    .from('platform_flags')
    .select('key, enabled, polarity, description, updated_at, updated_by')
  if (error) return NextResponse.json({ error: 'No se pudieron leer las flags.' }, { status: 500 })
  return NextResponse.json({ flags: data ?? [] })
})

export const POST = withAdmin(async (req: NextRequest) => {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }

  // Reject an unknown key or a non-boolean `enabled` — a MUTATION rejects (never coerces).
  const parsed = parseFlagWriteBody(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const { userId } = await auth()

  const { error } = await db.from('platform_flags').upsert(
    {
      key: parsed.key,
      enabled: parsed.enabled,
      // Stamp polarity from the known-flag SSOT so a code-added-before-seed flag's
      // FIRST flip inserts a complete row (not NULL polarity). On an existing seeded
      // row this re-writes the same value — a no-op, never a clobber (PostgREST upserts
      // only the payload columns, so `description` on the seed is left intact).
      polarity: FLAG_META[parsed.key].polarity,
      updated_at: new Date().toISOString(),
      updated_by: userId ?? null,
    },
    { onConflict: 'key' },
  )
  if (error) return NextResponse.json({ error: 'No se pudo actualizar la flag.' }, { status: 500 })

  return NextResponse.json({ ok: true, key: parsed.key, enabled: parsed.enabled })
})
