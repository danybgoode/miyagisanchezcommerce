/**
 * GET|PUT /api/admin/print/editions/[id]/layout  (secret-gated)
 * Loads / saves the printed-edition builder layout document for an edition.
 * Editorial data only (AGENTS rule #2); see lib/print-layout-server.ts.
 */

import { NextRequest, NextResponse } from 'next/server'
import { checkAdminSecret } from '@/lib/print-server'
import { loadLayoutOrEmpty, upsertLayout } from '@/lib/print-layout-server'
import type { PrintLayoutDocument, PrintPageSize } from '@/lib/print-layout'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkAdminSecret(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  try {
    const layout = await loadLayoutOrEmpty(id)
    return NextResponse.json({ layout })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkAdminSecret(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const body = (await req.json().catch(() => null)) as
    | { page_size?: PrintPageSize; document?: PrintLayoutDocument }
    | null
  if (!body?.document || !Array.isArray(body.document.pages)) {
    return NextResponse.json({ error: 'document inválido' }, { status: 400 })
  }
  try {
    const layout = await upsertLayout(id, {
      page_size: body.page_size === 'media_carta' ? 'media_carta' : 'carta',
      document: body.document,
    })
    return NextResponse.json({ layout })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
