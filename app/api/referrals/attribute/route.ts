/**
 * POST /api/referrals/attribute
 *
 * Called once (client-side) after a visitor signs up. Reads the `ref` cookie set
 * by middleware and credits the referrer — but only for genuinely new accounts
 * (guards against an existing user clicking a referral link). Always clears the
 * cookie so it can't be re-applied.
 */
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { currentUser } from '@clerk/nextjs/server'
import { attributeReferral } from '@/lib/referrals'

export const dynamic = 'force-dynamic'

// Only attribute accounts created within this window (defensive: a ref cookie
// should only ever credit a brand-new signup, not a long-standing user).
const MAX_ACCOUNT_AGE_MS = 14 * 24 * 60 * 60 * 1000

export async function POST() {
  const jar = await cookies()
  const code = jar.get('ref')?.value ?? ''

  const clear = (body: Record<string, unknown>) => {
    const res = NextResponse.json(body)
    res.cookies.set('ref', '', { maxAge: 0, path: '/' })
    return res
  }

  if (!code) return NextResponse.json({ result: 'skipped' })

  const user = await currentUser()
  if (!user) return NextResponse.json({ result: 'skipped' }) // keep cookie until signed in

  const ageMs = Date.now() - (user.createdAt ?? Date.now())
  if (ageMs > MAX_ACCOUNT_AGE_MS) return clear({ result: 'skipped' })

  const email =
    user.primaryEmailAddress?.emailAddress ??
    user.emailAddresses?.[0]?.emailAddress ??
    null

  const result = await attributeReferral(code, user.id, email)
  return clear({ result })
}
