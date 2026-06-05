import { NextRequest, NextResponse } from 'next/server'
import { runSweepstakesDrawCron } from '@/lib/sweepstakes'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret') ?? req.nextUrl.searchParams.get('secret')
  const authz = req.headers.get('authorization')
  if (secret !== process.env.CRON_SECRET && authz !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runSweepstakesDrawCron()
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error('[sweepstakes cron] failed:', e)
    return NextResponse.json({ error: 'draw failed' }, { status: 500 })
  }
}
