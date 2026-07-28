/**
 * Admin feature-flag control (Clerk admin-gated via `withAdmin`, epic 09 ·
 * feature-flags-inhouse, Sprint 2). Sprint 2.3 moves this familiar Miyagi surface onto
 * Golden's control plane: it never writes `platform_flags` directly. The Clerk-admin gate runs
 * before the server-only Golden credential is used, and the verified Clerk user is carried as the
 * external audit actor alongside Golden's immutable definition version.
 *
 *   GET  /api/admin/flags   — list the credential-scoped Golden snapshot
 *   POST /api/admin/flags   — activate one Golden boolean with reason + expected snapshot version
 *
 * `withAdmin` 401s any non-admin BEFORE the handler runs (order = auth→validate), and writes a
 * best-effort Miyagi audit row on success. Golden's lifecycle audit is the authoritative mutation
 * record, including the external Clerk actor and immutable new version.
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { withAdmin } from '@/lib/admin/guard'
import { parseFlagWriteBody } from '@/lib/flags-admin'
import { getGoldenAdminSnapshot, GoldenFlagAdminUnavailable, setGoldenAdminFlag } from '@/lib/golden-flag-admin'

export const dynamic = 'force-dynamic'

export const GET = withAdmin(async () => {
  try {
    return NextResponse.json(await getGoldenAdminSnapshot())
  } catch (error) {
    if (error instanceof GoldenFlagAdminUnavailable)
      return NextResponse.json({ error: 'Golden no está disponible para administrar flags.' }, { status: 503 })
    throw error
  }
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

  if (!userId) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  try {
    const result = await setGoldenAdminFlag({ ...parsed, clerkActorId: userId })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ key: parsed.key, enabled: parsed.enabled, ...result })
  } catch (error) {
    if (error instanceof GoldenFlagAdminUnavailable)
      return NextResponse.json({ error: 'Golden no está disponible para administrar flags.' }, { status: 503 })
    throw error
  }
})
