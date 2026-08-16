/**
 * POST /api/admin/comunicaciones/sample — send one communication to yourself, with
 * sample data (marketplace-communications · S3.2).
 *
 * Clerk-admin gated by `withAdmin`, which 401s before this handler runs. Beyond that
 * the recipient is constrained to a compile-time allow-list (`SAMPLE_RECIPIENTS`) —
 * this route sends real mail from the platform's real domain, so a caller-supplied
 * address is refused, never adopted.
 *
 * Validate → decide → send, in that order, with the whole decision made by
 * `decideSampleSend` before the transport is touched.
 */
import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/admin/guard'
import { runAsSampleSend } from '@/lib/email'
import { COMMUNICATION_CATALOG } from '@/lib/notifications/catalog'
import { COMMUNICATION_FIXTURES } from '@/lib/notifications/fixtures'
import { decideSampleSend } from '@/lib/notifications/sample'

export const dynamic = 'force-dynamic'

export const POST = withAdmin(async (req: NextRequest) => {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }

  const decision = decideSampleSend(
    body,
    new Set(COMMUNICATION_CATALOG.map((entry) => entry.key)),
    new Set(Object.keys(COMMUNICATION_FIXTURES)),
  )
  if (!decision.ok) {
    return NextResponse.json({ error: decision.message, reason: decision.reason }, { status: decision.status })
  }

  const { key, to } = decision.request
  try {
    // `runAsSampleSend` marks every email this fixture sends with the [PRUEBA]
    // subject prefix and the banner, request-scoped, so a real notification going out
    // concurrently is untouched.
    await runAsSampleSend(key, () => COMMUNICATION_FIXTURES[key](to))
  } catch (error) {
    // A throwing fixture is a broken template, and saying "sent" would be the exact
    // dishonesty this surface exists to remove.
    return NextResponse.json(
      { error: 'La plantilla falló al generarse.', detail: error instanceof Error ? error.message : undefined },
      { status: 500 },
    )
  }

  // The senders are fire-and-forget by contract and do not return a transport result,
  // so this reports DISPATCHED, not DELIVERED. The inbox is the proof — which is the
  // whole point of the walkthrough this route exists for.
  return NextResponse.json({ ok: true, key, to, dispatched: true })
})
