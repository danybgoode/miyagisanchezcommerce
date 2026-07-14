import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { isEnabled } from '@/lib/flags'
import { decideGrowthTrack } from '@/lib/growth-track'
import { sendGrowthEvent } from '@/lib/growth-engine'

// Forwards setup-guide funnel events to the golden-beans Growth Engine
// (Roadmap/01-growth-engine/growth-engine-v1, Sprint 1 · Story 1.3), gated by
// growth.telemetry_enabled. Same-origin only, Clerk-authed — userId is resolved
// server-side (never trusted from the body), and the flag check happens here so
// no client code needs to know whether telemetry is on.
const KNOWN_EVENTS = new Set([
  'setup_guide_viewed',
  'setup_guide_step_completed',
  'setup_guide_share_tapped',
])

export async function POST(req: NextRequest) {
  const user = await currentUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { event, featureId, tags, metadata } = (body ?? {}) as Record<string, unknown>
  if (typeof event !== 'string' || !KNOWN_EVENTS.has(event)) {
    return NextResponse.json({ error: 'Unknown event' }, { status: 400 })
  }

  const enabled = await isEnabled('growth.telemetry_enabled')
  const decision = decideGrowthTrack(enabled, {
    userId: user.id,
    event,
    featureId: typeof featureId === 'string' ? featureId : undefined,
    tags: typeof tags === 'object' && tags !== null ? (tags as Record<string, unknown>) : undefined,
    metadata: typeof metadata === 'object' && metadata !== null ? (metadata as Record<string, unknown>) : undefined,
  })

  if (!decision.forward) {
    return NextResponse.json({ skipped: true }, { status: 200 })
  }

  await sendGrowthEvent(decision.payload)
  return NextResponse.json({ skipped: false }, { status: 202 })
}
