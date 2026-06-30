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

export const dynamic = 'force-dynamic'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const INTERNAL_SECRET = process.env.MEDUSA_INTERNAL_SECRET ?? ''

type MintedSeller = MedusaSellerForMirror & { source?: string | null; source_url?: string | null }

export async function POST(req: NextRequest) {
  if (!(await isEnabled('promoter.enabled'))) {
    return NextResponse.json({ ok: false }, { status: 404 })
  }
  if (!INTERNAL_SECRET) {
    return NextResponse.json({ ok: false, error: 'Configuración incompleta en el servidor.' }, { status: 500 })
  }

  const user = await currentUser().catch(() => null)
  if (!user) return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 })

  const promoter = await getPromoterByClerkId(user.id)
  if (!promoter) {
    return NextResponse.json({ ok: false, error: 'Vincula tu código de promotor primero.' }, { status: 403 })
  }

  let body: { name?: string; location?: string; description?: string } = {}
  try { body = await req.json() } catch { /* validated below */ }
  const name = (body.name ?? '').trim()
  if (name.length < 2) {
    return NextResponse.json({ ok: false, error: 'Escribe el nombre del negocio.' }, { status: 400 })
  }

  // Mint the unclaimed Medusa seller (the storefront's only read model).
  let seller: MintedSeller
  try {
    const res = await fetch(`${MEDUSA_BASE}/internal/sellers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      body: JSON.stringify({
        name,
        location: body.location?.trim() || null,
        description: body.description?.trim() || null,
        source: 'promoter',
        source_url: promoterSourceUrl(promoter.code, name),
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

  revalidateTag('shops', 'default')
  return NextResponse.json({
    ok: true,
    shopId: mirrorId,
    sellerMedusaId: seller.id,
    slug: seller.slug,
    name: seller.name,
  })
}
