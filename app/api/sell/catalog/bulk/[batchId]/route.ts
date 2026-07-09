import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { getBulkBatch } from '@/lib/catalog-bulk'

// GET /api/sell/catalog/bulk/[batchId] — read a staged batch back from
// Supabase (catalog-management S3 · 3.1). This is what makes the diff preview
// survive a page refresh mid-review — the Shopify failure mode the story's
// acceptance names explicitly.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ batchId: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const { batchId } = await params
  const found = await getBulkBatch(batchId, userId)
  if (!found) return NextResponse.json({ error: 'Lote no encontrado.' }, { status: 404 })

  return NextResponse.json(found)
}
