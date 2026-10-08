import { NextRequest } from 'next/server'
import { verifyWebhook } from '@clerk/nextjs/webhooks'
import { clerkClient } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { sendAccountWelcome } from '@/lib/email'
import { verifiedWelcomeEmail } from '@/lib/account-welcome'

export async function POST(req: NextRequest) {
  let event
  try { event = await verifyWebhook(req) } catch {
    return Response.json({ error: 'Invalid webhook signature' }, { status: 401 })
  }
  if (event.type !== 'user.created' && event.type !== 'user.updated') return Response.json({ ok: true })
  const user = event.data as { id?: string }
  if (!user.id) return Response.json({ error: 'Missing user id' }, { status: 400 })
  if (event.type === 'user.created') {
    const { error: createError } = await db.from('account_welcome_deliveries')
      .upsert({ clerk_user_id: user.id }, { onConflict: 'clerk_user_id', ignoreDuplicates: true })
    if (createError) {
      console.error('[clerk welcome] registration failed')
      return Response.json({ error: 'Welcome unavailable' }, { status: 503 })
    }
  }
  // Events may arrive out of order. Read Clerk's current state so a late
  // user.created can still send after an earlier verification update.
  let email: string | null
  try {
    const client = await clerkClient()
    const current = await client.users.getUser(user.id)
    email = verifiedWelcomeEmail(current.emailAddresses.map((address) => ({
      email_address: address.emailAddress,
      verification: { status: address.verification?.status },
    })))
  } catch {
    console.error('[clerk welcome] current user lookup failed')
    return Response.json({ error: 'Welcome unavailable' }, { status: 503 })
  }
  if (!email) return Response.json({ ok: true, waitingForVerifiedEmail: true })

  const { data: claimToken, error } = await db.rpc('reserve_account_welcome', { p_user_id: user.id, p_email: email })
  if (error) {
    console.error('[clerk welcome] reserve failed')
    return Response.json({ error: 'Welcome unavailable' }, { status: 503 })
  }
  if (!claimToken) return Response.json({ ok: true, duplicate: true })

  const result = await sendAccountWelcome({ to: email, clerkUserId: user.id })
  if (!result.ok) {
    const { error: releaseError } = await db.from('account_welcome_deliveries')
      .update({ state: 'pending', claimed_at: null, claim_token: null })
      .eq('clerk_user_id', user.id).eq('state', 'sending').eq('claim_token', claimToken)
    if (releaseError) console.error('[clerk welcome] release failed')
    return Response.json({ error: 'Welcome delivery unavailable' }, { status: 503 })
  }
  const { error: updateError } = await db.from('account_welcome_deliveries')
    .update({ state: 'sent', sent_at: new Date().toISOString(), provider_email_id: result.id, claim_token: null })
    .eq('clerk_user_id', user.id).eq('state', 'sending').eq('claim_token', claimToken)
  if (updateError) console.error('[clerk welcome] provider accepted but receipt update failed')
  return Response.json({ ok: true })
}
