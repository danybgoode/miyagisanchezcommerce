/**
 * POST /api/vende/fundadoras/apply — public, unauthenticated Tiendas Fundadoras
 * application (epic tiendas-fundadoras-acquisition, Stories 2.1–2.3).
 *
 * Rate-limited by IP → validated (incl. honeypot + required contact consent) →
 * flag + capacity gated (server-enforced; a stale page or a direct API call
 * cannot bypass a closed/full cohort) → deduped/enriched into the ONE canonical
 * `merchant_relationships` row → append-only consent ledger → PII-free
 * `fundadoras_application_accepted` event keyed on the OPAQUE relationship id.
 *
 * Non-leak (acceptance 5): a created row, an enriched row, and (most) shape
 * refusals all return the SAME `{ ok: true }` / generic-error shape — the
 * response never tells a caller whether a phone/email already existed. No
 * Medusa seller/product/order is ever created here.
 */
import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'
import { isEnabled } from '@/lib/flags'
import {
  validateFundadorasApplicationInput,
  fundadorasApplicationRefusalMessage,
  decideFundadorasGateState,
  buildFundadorasEventPayload,
  type FundadorasApplicationInput,
} from '@/lib/fundadoras-application'
import {
  readFundadorasCapacityUsed,
  persistFundadorasApplication,
} from '@/lib/fundadoras-application-server'
import { sendGrowthEvent } from '@/lib/growth-engine'
import { tg } from '@/lib/telegram'

export const dynamic = 'force-dynamic'

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://miyagisanchez.com'

export async function POST(req: NextRequest) {
  // 1. Rate limit.
  const rl = await checkRateLimit('fundadoras_apply', getClientIp(req))
  if (!rl.allowed) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })
  }

  // 2. Parse.
  let body: FundadorasApplicationInput
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }

  // 3. Validate (pure).
  const result = validateFundadorasApplicationInput(body)
  if (!result.ok) {
    // Honeypot: pretend success so a bot never learns the trap exists.
    if (result.reason === 'honeypot') return NextResponse.json({ ok: true })
    return NextResponse.json({ error: fundadorasApplicationRefusalMessage(result.reason) }, { status: 400 })
  }

  // 4. Flag + capacity gate — RE-ENFORCED here regardless of what the UI showed.
  //    A read failure fails CLOSED (capacityUsed=null ⇒ treat as full).
  const flagEnabled = await isEnabled('growth.founding_merchants_enabled')
  const capacityUsed = await readFundadorasCapacityUsed()
  const gate = decideFundadorasGateState(flagEnabled, capacityUsed ?? Number.MAX_SAFE_INTEGER)
  if (gate !== 'open') {
    // Closed (flag off) → 404 so the route is indistinguishable from absent;
    // full → 409. Neither emits an accepted event.
    const status = gate === 'closed' ? 404 : 409
    return NextResponse.json({ error: 'closed' }, { status })
  }

  // 5. Persist (idempotency → dedupe/enrich or insert → consent ledger).
  const outcome = await persistFundadorasApplication(result.clean)
  if (!outcome.ok) {
    return NextResponse.json({ error: 'No se pudo enviar la solicitud. Intenta de nuevo.' }, { status: 502 })
  }

  // 6. PII-free accepted event — ONLY on a fresh accept (not an idempotent
  //    replay), keyed on the opaque relationship id, built server-side so no
  //    form value can ride along.
  if (!outcome.idempotentReplay) {
    const telemetryOn = await isEnabled('growth.telemetry_enabled')
    if (telemetryOn) {
      const payload = buildFundadorasEventPayload('fundadoras_application_accepted', outcome.relationshipId, {
        utm_source: result.clean.utm.utm_source,
        cohort_state: 'open',
      })
      // Fire-and-forget — telemetry is observability, never blocks the write.
      sendGrowthEvent(payload).catch((e) => console.error('[fundadoras-apply] growth emit failed:', e))
    }
    // Best-effort admin notification. Carries only the business name + coarse
    // location (the same precedent the promoter-application ping already sets);
    // the full PII record lives in the canonical relationship, not here.
    const location = result.clean.estado ?? result.clean.municipio ?? null
    tg.foundingApplicationSubmitted(result.clean.businessName, location, `${SITE}/admin/relationships`).catch((e) =>
      console.error('[fundadoras-apply] tg notify failed:', e),
    )
  }

  // 7. Uniform success shape for create AND enrich (non-leak).
  return NextResponse.json({ ok: true })
}
