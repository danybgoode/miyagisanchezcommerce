/**
 * POST|DELETE /api/admin/print/editions/[id]/lock  (secret-gated)
 *   POST   — "Enviar a imprenta": lock the layout + flip edition → in_production.
 *   DELETE — reopen: clear the lock so the builder is editable again.
 */

import { NextRequest, NextResponse } from 'next/server'
import { checkAdminSecret } from '@/lib/print-server'
import { setLayoutLock } from '@/lib/print-layout-server'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkAdminSecret(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  try {
    const locked_at = await setLayoutLock(id, true)
    return NextResponse.json({ ok: true, locked_at })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkAdminSecret(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  try {
    await setLayoutLock(id, false)
    return NextResponse.json({ ok: true, locked_at: null })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
