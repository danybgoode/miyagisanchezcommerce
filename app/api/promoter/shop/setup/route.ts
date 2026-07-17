/**
 * POST /api/promoter/shop/setup — a bound promoter stands up an UNCLAIMED shop
 * for a merchant (epic 08 · S4 · US-11), so the business is live on Miyagi before
 * the owner ever logs in. Reuses the Gem-Claim Loop primitives: mint a real Medusa
 * seller (`clerk_user_id` NULL, idempotent on a `promoter://` source_url) →
 * mirror it into Supabase → record an `enrolled` promoter attribution against the
 * mirror id (which SURVIVES the later claim — the claim only flips clerk_user_id,
 * never the mirror/seller id). The merchant claims it via the WhatsApp link
 * (POST /api/promoter/claim/link). Clerk- + `promoter.enabled`-gated.
 */
import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { revalidateTag } from 'next/cache'
import { isEnabled } from '@/lib/flags'
import { getPromoterByClerkId, recordAttribution } from '@/lib/promoter'
import { promoterSourceUrl } from '@/lib/promoter-close'
import { ensureUnclaimedShopMirror, type MedusaSellerForMirror } from '@/lib/provisioning'
import { autoGrantPartnerOnClose } from '@/lib/partner-grant-server'

export const dynamic = 'force-dynamic'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const INTERNAL_SECRET = process.env.MEDUSA_INTERNAL_SECRET ?? ''

type MintedSeller = MedusaSellerForMirror & { source?: string | null; source_url?: string | null }

export async function POST(req: NextRequest) {
  if (!(await isEnabled('promoter.enabled'))) {
    return NextResponse.json({ ok: false }, { status: 404 })
  }

  // Auth gates BEFORE any config/secret check, so an anonymous caller always gets
  // 401 (never a 500 leaking that a prod-only secret is unset on preview).
  const user = await currentUser().catch(() => null)
  if (!user) return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 })

  const promoter = await getPromoterByClerkId(user.id)
  if (!promoter) {
    return NextResponse.json({ ok: false, error: 'Vincula tu código de promotor primero.' }, { status: 403 })
  }

  if (!INTERNAL_SECRET) {
    return NextResponse.json({ ok: false, error: 'Configuración incompleta en el servidor.' }, { status: 500 })
  }

  let body: {
    name?: string
    description?: string
    cp?: string
    estado?: string
    municipio?: string
    colonia?: string
    merchant_email?: string
  } = {}
  try { body = await req.json() } catch { /* validated below */ }
  const name = (body.name ?? '').trim()
  if (name.length < 2) {
    return NextResponse.json({ ok: false, error: 'Escribe el nombre del negocio.' }, { status: 400 })
  }

  // Sprint 5 (US-5.2) — structured estado/municipio/colonia (CP-first, from
  // /api/checkout/postal-lookup) replaces the old free-text location field.
  // `location` stays a plain "municipio, estado" string for every existing
  // reader (parseLocation, PDP, search) — same join order `parseLocation`
  // expects (city-like part first, state-like part second). `location_detail`
  // carries the precise fields for Sprint 5's coverage matcher (US-5.3), which
  // treats it as optional (older shops only have the free-text `location`).
  const estado = body.estado?.trim() || null
  const municipio = body.municipio?.trim() || null
  const colonia = body.colonia?.trim() || null
  const cp = body.cp?.trim() || null
  const location = [municipio, estado].filter(Boolean).join(', ') || null
  const locationDetail = (cp || estado || municipio || colonia)
    ? { cp, estado, municipio, colonia }
    : null

  // Sprint 5 (US-5.5) — optional merchant email, so the close-completion
  // receipt has somewhere real to land. Falls back to the promoter's own
  // email (adapted copy) when the promoter didn't capture one.
  const merchantEmailRaw = body.merchant_email?.trim() || null
  const merchantEmail = merchantEmailRaw && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(merchantEmailRaw)
    ? merchantEmailRaw
    : null

  const metadata = (locationDetail || merchantEmail)
    ? { ...(locationDetail ? { location_detail: locationDetail } : {}), ...(merchantEmail ? { merchant_email: merchantEmail } : {}) }
    : undefined

  // Mint the unclaimed Medusa seller (the storefront's only read model).
  let seller: MintedSeller
  try {
    const res = await fetch(`${MEDUSA_BASE}/internal/sellers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      body: JSON.stringify({
        name,
        location,
        description: body.description?.trim() || null,
        source: 'promoter',
        source_url: promoterSourceUrl(promoter.code, name),
        metadata,
      }),
    })
    const data = (await res.json().catch(() => ({}))) as { seller?: MintedSeller; message?: string }
    if (!res.ok || !data.seller) {
      throw new Error(`seller create failed (${res.status}): ${data.message ?? 'no data'}`)
    }
    seller = data.seller
  } catch (e) {
    console.error('[promoter/shop/setup] mint failed:', e)
    return NextResponse.json({ ok: false, error: 'No se pudo crear la tienda. Intenta de nuevo.' }, { status: 502 })
  }

  // Mirror (conversations/offers/short links + the attribution seller_id key).
  const mirrorId = await ensureUnclaimedShopMirror(seller).catch((e) => {
    console.error('[promoter/shop/setup] mirror failed:', e)
    return null
  })
  if (!mirrorId) {
    return NextResponse.json({ ok: false, error: 'La tienda se creó pero no se pudo registrar. Avísale al equipo.' }, { status: 502 })
  }

  // Enroll the attribution now (survives the claim) so the promoter's link is
  // credited even before the close. Idempotent on (promoter, seller, sku).
  await recordAttribution({ promoterId: promoter.id, sellerId: mirrorId, sku: 'custom_domain' })

  // Miyagi Partners · Sprint 2 (US-2.1) — this is the ONE seam every close
  // variant converges on (the shop is created HERE; every /api/promoter/close/*
  // route only operates on a shop that already exists). If this promoter holds
  // a partner MCP credential, auto-grant them manager access to the shop they
  // just stood up. Best-effort; NEVER fails the close — see lib/partner-grant-server.ts.
  await autoGrantPartnerOnClose({ promoterId: promoter.id, shopId: mirrorId })

  revalidateTag('shops', 'default')
  return NextResponse.json({
    ok: true,
    shopId: mirrorId,
    sellerMedusaId: seller.id,
    slug: seller.slug,
    // Sprint 5 (US-5.3) — carried forward so the client can pass it into the
    // print-ad step's coverage matcher with no extra round-trip.
    estado,
    municipio,
    name: seller.name,
  })
}
