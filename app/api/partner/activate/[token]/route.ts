import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { recruitingV3Enabled } from '@/lib/recruiting-v3'
import { completeFoundingOperatorActivation } from '@/lib/founding-operator-activation'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  if (!(await recruitingV3Enabled())) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const { token } = await params
  const locale = req.nextUrl.searchParams.get('lang') === 'es' ? 'es' : 'en'
  const activationPath = `/partner/activate/${token}${locale === 'es' ? '?lang=es' : ''}`
  const user = await currentUser()
  if (!user) {
    const returnTo = encodeURIComponent(activationPath)
    return NextResponse.redirect(new URL(`/sign-in?redirect_url=${returnTo}`, req.url), 303)
  }

  // The activation seam is the single owner of Clerk verified-email filtering
  // and normalization; SQL independently rechecks the normalized match under lock.
  const result = await completeFoundingOperatorActivation(token, user.id, user.emailAddresses)
  if (!result.ok) {
    // Infrastructure failure is not a bad invitation or principal mismatch.
    // Preserve the third state so the signed-in operator gets retry guidance.
    const status = result.reason === 'unavailable' ? 'unavailable' : 'invalid'
    const query = new URLSearchParams({ status })
    if (locale === 'es') query.set('lang', 'es')
    return NextResponse.redirect(new URL(`/partner/activate/${token}?${query}`, req.url), 303)
  }
  return NextResponse.redirect(new URL(locale === 'es' ? '/partner?lang=es' : '/partner', req.url), 303)
}
