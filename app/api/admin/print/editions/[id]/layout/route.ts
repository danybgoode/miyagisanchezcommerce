/**
 * GET|PUT /api/admin/print/editions/[id]/layout  (Clerk admin-gated via withAdmin)
 * Loads / saves the printed-edition builder layout document for an edition.
 * Editorial data only (AGENTS rule #2); see lib/print-layout-server.ts.
 */

import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/admin/guard'
import { loadLayoutOrEmpty, upsertLayout } from '@/lib/print-layout-server'
import type { PrintLayoutDocument, PrintPageSize } from '@/lib/print-layout'

export const dynamic = 'force-dynamic'

export const GET = withAdmin(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  try {
    const layout = await loadLayoutOrEmpty(id)
    return NextResponse.json({ layout })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
})

export const PUT = withAdmin(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
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
})
