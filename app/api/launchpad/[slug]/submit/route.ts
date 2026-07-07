/**
 * POST /api/launchpad/[slug]/submit — verify the email code + persist the
 * submission (bookshop-launchpad S1.1). The manuscript was already stored by
 * /upload; the client hands back the returned key, which we re-verify is
 * scoped to THIS shop (a client can't attach another shop's manuscript key).
 */
import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'
import { isEnabled } from '@/lib/flags'
import {
  getLaunchpadShopBySlug,
  verifyLaunchpadCode,
  createSubmission,
  isValidEmail,
} from '@/lib/launchpad'
import { MANUSCRIPT_FORMATS, type ManuscriptFormat } from '@/lib/launchpad-types'

export const dynamic = 'force-dynamic'

interface SubmitBody {
  title?: string
  synopsis?: string
  genre?: string
  authorName?: string
  email?: string
  code?: string
  manuscript?: { key?: string; format?: string; name?: string; size?: number }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const rl = await checkRateLimit('launchpad', getClientIp(req))
  if (!rl.allowed) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })
  }

  if (!(await isEnabled('launchpad.enabled'))) {
    return NextResponse.json({ error: 'launchpad_disabled' }, { status: 423 })
  }

  const { slug } = await params
  const shop = await getLaunchpadShopBySlug(slug)
  if (!shop) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!shop.acceptsManuscripts) return NextResponse.json({ error: 'not_accepting' }, { status: 422 })

  let body: SubmitBody
  try { body = await req.json() } catch { return NextResponse.json({ error: 'missing_fields' }, { status: 400 }) }

  const title = body.title?.trim()
  const authorName = body.authorName?.trim()
  const m = body.manuscript

  if (!title || title.length > 200) return NextResponse.json({ error: 'invalid_title' }, { status: 422 })
  if (!authorName || authorName.length > 120) return NextResponse.json({ error: 'invalid_author' }, { status: 422 })
  if (!body.email || !isValidEmail(body.email)) return NextResponse.json({ error: 'invalid_email' }, { status: 422 })
  if (!body.code?.trim()) return NextResponse.json({ error: 'missing_code' }, { status: 422 })
  if (!m?.key || !m.format || !MANUSCRIPT_FORMATS.includes(m.format as ManuscriptFormat)) {
    return NextResponse.json({ error: 'missing_manuscript' }, { status: 422 })
  }
  // Ownership guard: the key must be one this shop's /upload minted. Prevents a
  // client attaching an arbitrary (or another shop's) private-bucket object.
  if (!m.key.startsWith(`launchpad/${shop.id}/`)) {
    return NextResponse.json({ error: 'invalid_manuscript' }, { status: 422 })
  }

  const verified = await verifyLaunchpadCode(shop, body.email, body.code)
  if (!verified) return NextResponse.json({ error: 'invalid_code' }, { status: 422 })

  try {
    const submission = await createSubmission({
      shop,
      title,
      synopsis: body.synopsis ?? null,
      genre: body.genre ?? null,
      authorName,
      authorEmail: body.email,
      manuscript: {
        key: m.key,
        format: m.format as ManuscriptFormat,
        name: (m.name ?? '').slice(0, 200) || 'manuscrito',
        size: typeof m.size === 'number' ? m.size : 0,
      },
    })
    return NextResponse.json({ ok: true, submission_id: submission.id })
  } catch (e) {
    console.error('[launchpad] submit failed:', e)
    return NextResponse.json({ error: 'unavailable' }, { status: 500 })
  }
}
