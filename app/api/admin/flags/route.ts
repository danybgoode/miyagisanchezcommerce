/**
 * `GET /api/admin/flags` — the read-only Golden mirror as JSON (Clerk admin-gated via `withAdmin`).
 *
 * flag-provider-mandate S2.1: there is NO write handler here, deliberately — not hidden, gone.
 * Next.js answers any POST/PUT/PATCH/DELETE with 405 because no handler exists, so no body, header
 * or session can reach a write. Flags change only in Golden's console (`GOLDEN_FLAG_CONSOLE_URL`).
 */
import { NextResponse } from 'next/server'
import { withAdmin } from '@/lib/admin/guard'
import { readGoldenFlagSnapshot } from '@/lib/golden-flag-provider'
import { GOLDEN_FLAG_CONSOLE_URL, mirrorRowsFromSnapshot } from '@/lib/flags-mirror-view'

export const dynamic = 'force-dynamic'

export const GET = withAdmin(async () => {
  const snapshot = await readGoldenFlagSnapshot()
  if (!snapshot) {
    return NextResponse.json(
      { error: 'Golden no está disponible para leer flags.', console: GOLDEN_FLAG_CONSOLE_URL },
      { status: 503 },
    )
  }
  return NextResponse.json({
    readOnly: true,
    console: GOLDEN_FLAG_CONSOLE_URL,
    environment: snapshot.environment,
    snapshotVersion: snapshot.snapshotVersion,
    flags: mirrorRowsFromSnapshot(snapshot),
  })
})
