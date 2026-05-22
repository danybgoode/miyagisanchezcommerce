/**
 * POST /api/stripe/billing-portal
 *
 * Creates a Stripe Customer Portal session for the authenticated buyer.
 * The buyer can update their payment method, view invoices, and cancel.
 *
 * Body: { returnUrl?: string }
 * Returns: { url: string }
 */
import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { createBillingPortalSession } from '@/lib/stripe-subscriptions'

export async function POST(req: NextRequest) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  let body: { returnUrl?: string } = {}
  try { body = await req.json() } catch { /* optional */ }

  const buyerEmail = user.emailAddresses?.[0]?.emailAddress ?? ''

  // Find any Stripe subscription for this user (we need the customer ID)
  const { data: sub } = await db
    .from('marketplace_subscriptions')
    .select('stripe_customer_id')
    .or(`buyer_clerk_user_id.eq.${user.id},buyer_email.ilike.${buyerEmail}`)
    .eq('payment_method', 'stripe')
    .not('stripe_customer_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!sub?.stripe_customer_id) {
    return NextResponse.json(
      { error: 'No se encontró un cliente de Stripe activo.' },
      { status: 404 },
    )
  }

  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? `https://${req.headers.get('host')}`
  const returnUrl = body.returnUrl ?? `${origin}/account/subscriptions`

  const url = await createBillingPortalSession(sub.stripe_customer_id, returnUrl)
  return NextResponse.json({ url })
}
