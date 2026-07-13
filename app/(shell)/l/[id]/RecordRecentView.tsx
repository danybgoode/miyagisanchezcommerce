'use client'

import { useEffect } from 'react'
import { recordView } from '@/lib/home-recently-viewed'

/**
 * home-dynamic-rows-restore-and-polish S2.3 — records a PDP view to the visitor's
 * device-local recently-viewed ring buffer (`lib/home-recently-viewed.ts`). Fires for
 * every visitor (signed-in or not) — harmless, device-local, only ever consumed by the
 * signed-in homepage rail. Renders nothing.
 */
export default function RecordRecentView({ medusaId }: { medusaId: string }) {
  useEffect(() => {
    recordView(medusaId)
  }, [medusaId])
  return null
}
