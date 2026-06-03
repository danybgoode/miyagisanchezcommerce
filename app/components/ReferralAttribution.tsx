'use client'

import { useEffect } from 'react'
import { useAuth } from '@clerk/nextjs'

/**
 * Fires referral attribution once after a signed-in visitor lands with a `ref`
 * cookie (set by middleware from `?ref=CODE`). The server route validates that
 * the account is genuinely new and clears the cookie. Mounted globally so it
 * works wherever the user lands after sign-up.
 */
export default function ReferralAttribution() {
  const { isSignedIn } = useAuth()

  useEffect(() => {
    if (!isSignedIn) return
    if (typeof document === 'undefined') return
    if (!/(?:^|;\s*)ref=/.test(document.cookie)) return
    if (sessionStorage.getItem('ref_attributed') === '1') return
    sessionStorage.setItem('ref_attributed', '1')
    fetch('/api/referrals/attribute', { method: 'POST' }).catch(() => {})
  }, [isSignedIn])

  return null
}
