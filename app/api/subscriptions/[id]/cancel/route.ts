import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { cancelSubscriptionAtPeriodEnd } from '@/lib/stripe-subscriptions'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const clerkUser = await currentUser()
  if (!clerkUser) {
    return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })
  }

  const { id } = await params

  // ── Fetch subscription and verify ownership ───────────────────────────────
  const { data: sub } = await db
    .from('marketplace_subscriptions')
    .select('id, status, stripe_subscription_id, buyer_clerk_user_id, buyer_email, cancel_at_period_end')
    .eq('id', id)
    .maybeSingle()

  if (!sub) {
    return NextResponse.json({ error: 'Suscripción no encontrada.' }, { status: 404 })
  }

  const buyerEmail = clerkUser.emailAddresses?.[0]?.emailAddress ?? ''
  const isOwner = sub.buyer_clerk_user_id === clerkUser.id ||
    sub.buyer_email?.toLowerCase() === buyerEmail.toLowerCase()

  if (!isOwner) {
    return NextResponse.json({ error: 'Sin permisos.' }, { status: 403 })
  }

  if (sub.status === 'canceled') {
    return NextResponse.json({ error: 'Esta suscripción ya fue cancelada.' }, { status: 409 })
  }

  if (sub.cancel_at_period_end) {
    return NextResponse.json({ error: 'La cancelación ya está programada.' }, { status: 409 })
  }

  // ── Cancel at period end (graceful) ───────────────────────────────────────
  if (sub.stripe_subscription_id) {
    await cancelSubscriptionAtPeriodEnd(sub.stripe_subscription_id)
  }

  await db
    .from('marketplace_subscriptions')
    .update({ cancel_at_period_end: true, updated_at: new Date().toISOString() })
    .eq('id', id)

  return NextResponse.json({
    ok: true,
    message: 'Tu suscripción se cancelará al final del período actual.',
  })
}
