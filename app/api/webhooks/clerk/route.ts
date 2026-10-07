import { NextRequest } from 'next/server'
import { verifyWebhook } from '@clerk/nextjs/webhooks'
import { db } from '@/lib/supabase'
import { sendAccountWelcome } from '@/lib/email'
import { verifiedWelcomeEmail } from '@/lib/account-welcome'

type EmailRow = { email_address?: string; verification?: { status?: string } }

export async function POST(req: NextRequest) {
  let event
  try { event = await verifyWebhook(req) } catch {
    return Response.json({ error: 'Invalid webhook signature' }, { status: 401 })
  }
  if (event.type !== 'user.created' && event.type !== 'user.updated') return Response.json({ ok: true })
  const user = event.data as { id?: string; email_addresses?: EmailRow[]; primary_email_address_id?: string }
  if (!user.id) return Response.json({ error: 'Missing user id' }, { status: 400 })
  // Clerk can emit user.created before email verification. user.updated supplies
  // the later verified address; never welcome an inbox the account does not own.
  const email = verifiedWelcomeEmail(user.email_addresses ?? [])
  if (event.type === 'user.created') {
    const { error: createError } = await db.from('account_welcome_deliveries')
      .upsert({ clerk_user_id: user.id }, { onConflict: 'clerk_user_id', ignoreDuplicates: true })
    if (createError) {
      console.error('[clerk welcome] registration failed', createError)
      return Response.json({ error: 'Welcome unavailable' }, { status: 503 })
    }
  }
  if (!email) return Response.json({ ok: true, waitingForVerifiedEmail: true })

  const { data, error } = await db.rpc('claim_account_welcome', { p_user_id: user.id, p_email: email })
  if (error) {
    console.error('[clerk welcome] reserve failed', error)
    return Response.json({ error: 'Welcome unavailable' }, { status: 503 })
  }
  if (!data) return Response.json({ ok: true, duplicate: true })

  const result = await sendAccountWelcome({ to: email, clerkUserId: user.id })
  if (!result.ok) {
    const { error: releaseError } = await db.from('account_welcome_deliveries')
      .update({ state: 'pending', claimed_at: null }).eq('clerk_user_id', user.id).eq('state', 'sending')
    if (releaseError) console.error('[clerk welcome] release failed', releaseError)
    return Response.json({ error: 'Welcome delivery unavailable' }, { status: 503 })
  }
  const { error: updateError } = await db.from('account_welcome_deliveries')
    .update({ state: 'sent', sent_at: new Date().toISOString(), provider_email_id: result.id })
    .eq('clerk_user_id', user.id)
  if (updateError) console.error('[clerk welcome] provider accepted but receipt update failed', updateError)
  return Response.json({ ok: true })
}
