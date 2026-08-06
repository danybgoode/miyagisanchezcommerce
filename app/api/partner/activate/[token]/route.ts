import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { recruitingV3Enabled } from '@/lib/recruiting-v3'
import { completeFoundingOperatorActivation } from '@/lib/founding-operator-activation'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  if (!(await recruitingV3Enabled())) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const { token } = await params
  const user = await currentUser()
  if (!user) {
    const returnTo = encodeURIComponent(`/partner/activate/${token}`)
    return NextResponse.redirect(new URL(`/sign-in?redirect_url=${returnTo}`, req.url), 303)
  }

  // Verified is a Clerk fact, not primary/first-email position. The SQL RPC
  // independently rechecks the normalized match while holding the token row.
  const verifiedEmails = user.emailAddresses.filter((email) => email.verification?.status === 'verified')
  const result = await completeFoundingOperatorActivation(token, user.id, verifiedEmails)
  if (!result.ok) {
    return NextResponse.redirect(new URL(`/partner/activate/${token}?status=invalid`, req.url), 303)
  }
  return NextResponse.redirect(new URL('/partner', req.url), 303)
}
