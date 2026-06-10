import { NextRequest } from 'next/server'
import { signClaimToken } from '@/lib/claimJwt'
import { db } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  // Top-level guard — always return JSON even on unexpected errors
  try {
    return await handlePost(req)
  } catch (err) {
    console.error('[claim/send] unhandled error:', err)
    return Response.json({ error: 'Error interno. Intenta de nuevo.' }, { status: 500 })
  }
}

async function handlePost(req: NextRequest) {
  let body: Record<string, string>
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { shopId, shopSlug, shopName, email, message } = body

  if (!shopId || !shopSlug || !shopName || !email) {
    return Response.json({ error: 'Missing required fields: shopId, shopSlug, shopName, email' }, { status: 400 })
  }

  if (!process.env.CLAIM_JWT_SECRET) {
    console.error('[claim/send] CLAIM_JWT_SECRET is not set')
    return Response.json({ error: 'Configuración incompleta en el servidor.' }, { status: 500 })
  }

  const token = await signClaimToken({ shopId, shopSlug, shopName, email })

  const despachoBonsaiUrl = process.env.DESPACHOBONSAI_URL ?? 'https://dashboard.despachobonsai.com'
  const claimUrl = `${despachoBonsaiUrl}/onboarding/claim?token=${token}`

  // Upsert a pending claim in Supabase. marketplace_claims.shop_id is a UUID
  // FK to marketplace_shops — the claim page passes the MEDUSA seller id, so
  // resolve the mirror row first (the old direct upsert silently errored).
  let claimShopId: string | null = shopId
  if (shopId.startsWith('sel_')) {
    const { data: mirror } = await db
      .from('marketplace_shops')
      .select('id')
      .contains('metadata', { medusa_seller_id: shopId })
      .maybeSingle()
    claimShopId = (mirror?.id as string | undefined) ?? null
  }
  if (claimShopId) {
    await db.from('marketplace_claims').upsert(
      {
        shop_id: claimShopId,
        clerk_user_id: `pending:${email}`,
        status: 'pending',
        message: message ?? null,
      },
      { onConflict: 'shop_id,clerk_user_id' }
    )
  }

  const resendApiKey = process.env.RESEND_API_KEY
  if (resendApiKey) {
    try {
      const { Resend } = await import('resend')
      const resend = new Resend(resendApiKey)
      const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'onboarding@miyagisanchez.com'

      const htmlBody = `
<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
  <h2 style="color:#1a1a1a">Hola 👋</h2>
  <p>Alguien (posiblemente tú) solicitó reclamar la tienda <strong>${shopName}</strong> en miyagisanchez.com.</p>
  <p>Haz clic en el botón para continuar. El enlace expira en 24 horas.</p>
  <a href="${claimUrl}" style="display:inline-block;background:#3a8a7a;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;margin:16px 0">Reclamar tienda →</a>
  <p style="color:#666;font-size:12px">Si no solicitaste esto, ignora este mensaje.</p>
</div>
`

      await resend.emails.send({
        from: `miyagisanchez.com <${fromEmail}>`,
        to: email,
        subject: `Reclama tu tienda "${shopName}" en miyagisanchez.com`,
        html: htmlBody,
      })

      return Response.json({ ok: true, sent: true })
    } catch (err) {
      console.error('Resend error:', err)
      // Fall through to return link anyway
    }
  }

  return Response.json({ ok: true, sent: false, link: claimUrl })
}
