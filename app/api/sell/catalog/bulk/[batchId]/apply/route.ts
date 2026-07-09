import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { applyBulkBatch } from '@/lib/catalog-bulk'

// POST /api/sell/catalog/bulk/[batchId]/apply — apply an already-staged batch
// (catalog-management S3 · 3.1). Idempotent: an item already applied on a
// prior call is skipped, not re-executed — a re-run reports "ya aplicado"
// rather than mutating again.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ batchId: string }> }) {
  const { userId, getToken } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const clerkJwt = await getToken()
  if (!clerkJwt) return NextResponse.json({ error: 'Error de autenticación.' }, { status: 401 })

  const { batchId } = await params
  const result = await applyBulkBatch(batchId, { userId, clerkJwt })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  return NextResponse.json({ applied: result.applied, failed: result.failed, skipped: result.skipped })
}
