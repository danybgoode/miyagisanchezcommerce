import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Routes that require a signed-in user
const isProtected = createRouteMatcher([
  '/shop/manage(.*)',
])

// Hostnames that are part of the miyagisanchez platform itself
const PLATFORM_HOSTS = [
  'miyagisanchez.com',
  'www.miyagisanchez.com',
  'localhost',
  '127.0.0.1',
]

function isPlatformHost(hostname: string): boolean {
  if (PLATFORM_HOSTS.some(h => hostname === h || hostname.startsWith(h + ':'))) return true
  // Vercel preview / branch URLs
  if (hostname.endsWith('.vercel.app')) return true
  return false
}

export default clerkMiddleware(async (auth, req: NextRequest) => {
  const hostname = req.headers.get('host') ?? ''

  // ── Custom domain routing ────────────────────────────────────────────────
  // If the request arrives on a tenant's own domain (not *.miyagisanchez.com
  // or *.vercel.app), look up which shop owns that domain and rewrite
  // transparently to /s/[slug]. The shop page detects x-miyagi-channel:custom
  // and renders the standalone channel layout (no platform chrome).

  if (!isPlatformHost(hostname)) {
    // Strip port for DB lookup (e.g. "myshop.mx:3001" → "myshop.mx")
    const domain = hostname.split(':')[0].toLowerCase()

    try {
      const supabase = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      )
      const { data: shop } = await supabase
        .from('marketplace_shops')
        .select('slug')
        .eq('custom_domain', domain)
        .maybeSingle()

      if (shop?.slug) {
        // Rewrite the request to /s/[slug] but keep the custom domain visible
        // in the browser. Inject header so the page knows it's a channel request.
        const url = req.nextUrl.clone()
        url.pathname = `/s/${shop.slug}`
        const res = NextResponse.rewrite(url)
        res.headers.set('x-miyagi-channel', 'custom')
        res.headers.set('x-miyagi-domain', domain)
        return res
      }
    } catch {
      // If DB is unreachable, fall through — don't 500 on DNS lookup failure
    }

    // Domain registered but no matching shop → clean 404
    return new NextResponse(
      '<!doctype html><html><head><title>Not found</title></head><body><p>Shop not found.</p></body></html>',
      { status: 404, headers: { 'Content-Type': 'text/html' } }
    )
  }

  // ── Standard platform routing ────────────────────────────────────────────
  if (isProtected(req)) await auth.protect()

  // ── Referral capture ──────────────────────────────────────────────────────
  // A `?ref=CODE` on any platform page is stashed in a 30-day cookie. After the
  // visitor signs up, the client posts to /api/referrals/attribute, which reads
  // this cookie to credit the referrer.
  const ref = req.nextUrl.searchParams.get('ref')
  if (ref && /^[A-Za-z0-9]{4,12}$/.test(ref)) {
    const res = NextResponse.next()
    res.cookies.set('ref', ref.toUpperCase(), {
      maxAge: 60 * 60 * 24 * 30,
      path: '/',
      sameSite: 'lax',
    })
    return res
  }
})

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
