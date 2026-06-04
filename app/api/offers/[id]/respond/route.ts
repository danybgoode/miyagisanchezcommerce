import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { respondToOffer } from '@/lib/offer-respond'

interface RespondBody {
  action: 'accept' | 'counter' | 'decline'
  counterAmountCents?: number
  counterMessage?: string
}

/**
 * Seller responds to a buyer's offer. The accept/counter/decline logic lives in
 * lib/offer-respond.ts so this route and the seller MCP `respond_to_offer` tool
 * run one shared code path.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 })

  let body: RespondBody
  try {
    body = await req.json() as RespondBody
  } catch {
    return NextResponse.json({ error: 'Payload inválido.' }, { status: 400 })
  }

  const result = await respondToOffer({
    offerId: id,
    authorizedClerkUserId: user.id,
    origin: req.headers.get('origin') ?? 'https://miyagisanchez.com',
    action: body.action,
    counterAmountCents: body.counterAmountCents,
    counterMessage: body.counterMessage,
  })

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, ...(result.field ? { field: result.field } : {}) },
      { status: result.httpStatus },
    )
  }
  return NextResponse.json({ status: result.status })
}
