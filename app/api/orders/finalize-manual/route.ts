/**
 * POST /api/orders/finalize-manual
 *
 * Thin Clerk-authed wrapper over `sendManualOrderEmails` (lib/orders/manual-order-emails.ts),
 * which holds the real logic and the full history of why it exists.
 *
 * The in-process checkout path does NOT come through here any more — `lib/cart.ts`
 * calls the library directly, because reaching this route with a server-side
 * `fetch()` carried no Clerk cookie and 401'd on every manual order for a month.
 * This route remains for external / retry callers that do have a session.
 *
 * Body: { orderId }    Auth: Clerk session
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { sendManualOrderEmails } from '@/lib/orders/manual-order-emails'

export async function POST(req: NextRequest) {
  let body: { orderId?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad body' }, { status: 400 }) }
  const orderId = body.orderId
  if (!orderId) return NextResponse.json({ error: 'orderId required' }, { status: 400 })

  const { userId, getToken } = await auth()
  const clerkJwt = await getToken()
  if (!clerkJwt) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // `buyerClerkUserId` comes from the SESSION, never the body — it addresses a push
  // notification, so a caller-supplied id would let anyone notify anyone.
  const result = await sendManualOrderEmails({ orderId, clerkJwt, buyerClerkUserId: userId ?? null })

  // 200 either way (this is a best-effort side-effect endpoint) but the body reports
  // honestly what happened, so a caller that checks can tell "sent" from "skipped".
  return NextResponse.json(result)
}
