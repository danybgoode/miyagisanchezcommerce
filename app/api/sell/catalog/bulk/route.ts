import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { stageBulkAction, type BulkActionPayload, type BulkFilterParams } from '@/lib/catalog-bulk'

// POST /api/sell/catalog/bulk — stage a bulk action (catalog-management S3 · 3.1).
// Resolves target products (explicit ids or the active table filter), computes
// a before/after diff per product, persists the staged batch to Supabase.
// Writes nothing to Medusa — see /api/sell/catalog/bulk/[batchId]/apply for that.
export async function POST(req: NextRequest) {
  const { userId, getToken } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  let body: { filter?: BulkFilterParams; ids?: string[]; action?: BulkActionPayload }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 }) }

  if (!body.action?.type) return NextResponse.json({ error: 'action es requerido.' }, { status: 422 })
  if (!body.ids?.length && !body.filter) {
    return NextResponse.json({ error: 'Debes indicar ids o un filtro.' }, { status: 422 })
  }

  const clerkJwt = await getToken()
  if (!clerkJwt) return NextResponse.json({ error: 'Error de autenticación.' }, { status: 401 })

  const result = await stageBulkAction(
    { userId, clerkJwt },
    { filter: body.filter, ids: body.ids },
    body.action,
  )

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  return NextResponse.json({
    batch_id: result.batch_id,
    total: result.total,
    valid_count: result.valid_count,
    invalid_count: result.invalid_count,
  })
}
