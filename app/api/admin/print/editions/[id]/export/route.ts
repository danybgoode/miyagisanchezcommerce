/**
 * GET /api/admin/print/editions/[id]/export  (Clerk admin-gated via withAdmin)
 * Streams the production ZIP pack (approved ads: copy + photos + logo + QR,
 * plus spec.txt + index.html) for hand layout in InDesign/Affinity.
 */

import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/admin/guard'
import { buildEditionExportZip } from '@/lib/print-export'

export const dynamic = 'force-dynamic'
// Larger editions take time to fetch + zip all assets.
export const maxDuration = 60

export const GET = withAdmin(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const result = await buildEditionExportZip(id)
  if (!result) return NextResponse.json({ error: 'Edición no encontrada.' }, { status: 404 })
  if (result.adCount === 0) {
    return NextResponse.json({ error: 'No hay anuncios aprobados en esta edición todavía.' }, { status: 422 })
  }

  return new NextResponse(new Uint8Array(result.buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${result.filename}"`,
      'Cache-Control': 'no-store',
    },
  })
})
