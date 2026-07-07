/**
 * GET /api/sell/launchpad/submissions — the authenticated shop's own manuscript
 * submissions, newest first (bookshop-launchpad S1.2). Behind `launchpad.enabled`.
 */
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { isEnabled } from '@/lib/flags'
import { getLaunchpadShopForClerk, listSubmissionsForShop } from '@/lib/launchpad'

export const dynamic = 'force-dynamic'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })
  if (!(await isEnabled('launchpad.enabled'))) return NextResponse.json({ submissions: [] })

  const shop = await getLaunchpadShopForClerk(userId)
  if (!shop) return NextResponse.json({ submissions: [] })

  const submissions = await listSubmissionsForShop(shop.id)
  // Never leak the storage key or the raw email hash to the client — the queue
  // reads the manuscript through the signed-URL download route, by id.
  const safe = submissions.map(s => ({
    id: s.id,
    status: s.status,
    title: s.title,
    synopsis: s.synopsis,
    genre: s.genre,
    author_name: s.author_name,
    author_email: s.author_email,
    manuscript_name: s.manuscript_name,
    manuscript_format: s.manuscript_format,
    manuscript_size: s.manuscript_size,
    review_note: s.review_note,
    // Hide the in-flight mint sentinel from the queue — only a real product id
    // flips the card to "published" (see publishSubmission's optimistic lock).
    published_product_id: s.published_product_id?.startsWith('pending:') ? null : s.published_product_id,
    created_at: s.created_at,
    updated_at: s.updated_at,
  }))
  return NextResponse.json({ submissions: safe })
}
