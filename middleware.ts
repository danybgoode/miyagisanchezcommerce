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
  // or *.vercel.app), look up which shop owns that domain and serve the WHOLE
  // storefront natively under that domain — white-label, no platform chrome.
  //
  // We resolve the shop once and tag the request with channel headers
  // (x-miyagi-channel / -domain / -shop-slug). The root layout reads them to
  // drop platform chrome and render the branded shell; pages read them to scope
  // content to this shop. Only the homepage `/` is rewritten to /s/[slug]; every
  // other storefront path (/l/[id], /checkout, /account, /api/*, …) passes
  // through unchanged so it renders/works natively on the tenant domain.

  if (!isPlatformHost(hostname)) {
    // Strip port for DB lookup (e.g. "myshop.mx:3001" → "myshop.mx")
    const domain = hostname.split(':')[0].toLowerCase()

    let slug: string | null = null
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
      slug = shop?.slug ?? null
    } catch {
      // DB unreachable → treat as unresolved (clean 404 below); never 500 a DNS hit.
    }

    if (slug) {
      // Boundary isolation: a tenant domain serves ONLY its own shop. Paths that
      // would expose the platform slug (`/s/...`) or browse across shops (the
      // marketplace-wide `/l` index) are redirected to the domain's own home, so
      // neither the slug nor another seller's catalog ever surfaces here. (A
      // single foreign product `/l/[id]` is caught at the page level → 404.)
      const path = req.nextUrl.pathname
      if (path === '/s' || path.startsWith('/s/') || path === '/l' || path === '/l/') {
        const home = req.nextUrl.clone()
        home.pathname = '/'
        home.search = ''
        return NextResponse.redirect(home)
      }

      // Tag the REQUEST headers so Server Components (layout + pages) can read
      // them via `headers()`. (Response headers are NOT visible to RSC — the
      // request-header option is the only mechanism that surfaces there.)
      const headers = new Headers(req.headers)
      headers.set('x-miyagi-channel', 'custom')
      headers.set('x-miyagi-domain', domain)
      headers.set('x-miyagi-shop-slug', slug)

      // Homepage → render the shop landing page, keeping the custom domain in
      // the address bar (transparent rewrite, slug never exposed).
      if (path === '/') {
        const url = req.nextUrl.clone()
        url.pathname = `/s/${slug}`
        return NextResponse.rewrite(url, { request: { headers } })
      }

      // Every other path serves natively under the tenant domain, white-label.
      return NextResponse.next({ request: { headers } })
    }

    // Domain points at us but no shop owns it → clean 404.
    return new NextResponse(
      '<!doctype html><html><head><title>Not found</title></head><body><p>Shop not found.</p></body></html>',
      { status: 404, headers: { 'Content-Type': 'text/html' } }
    )
  }

  // ── Platform host: strip spoofable trust headers ─────────────────────────
  // From here on we're on a platform host. The x-miyagi-* channel headers are
  // trusted by the layout/pages to decide white-label rendering and shop scope,
  // and ONLY middleware may set them — so drop any a client tried to inject.
  const headers = new Headers(req.headers)
  for (const h of ['x-miyagi-channel', 'x-miyagi-domain', 'x-miyagi-shop-slug', 'x-miyagi-embed', 'x-miyagi-path']) {
    headers.delete(h)
  }
  headers.set('x-miyagi-path', req.nextUrl.pathname)

  // ── Embed surface (full-shop iframe) ──────────────────────────────────────
  // Tag /embed/* requests so the root layout drops platform chrome (white-label
  // iframe). The route is served `frame-ancestors *` via next.config so any site
  // can frame it; buy actions break out to a top-level tab on our own origin.
  if (req.nextUrl.pathname.startsWith('/embed/')) {
    headers.set('x-miyagi-embed', '1')
    return NextResponse.next({ request: { headers } })
  }

  // ── Standard platform routing ────────────────────────────────────────────
  if (isProtected(req)) await auth.protect()

  // ── Referral + channel capture ────────────────────────────────────────────
  // `?ref=CODE` on any platform page is stashed in a 30-day cookie (read later by
  // /api/referrals/attribute to credit the referrer). `?channel=embed` (the
  // embeddable widget's hosted-checkout hand-off) is stashed in a short-lived
  // cookie so detectChannel() can tag the sale `embed` across the checkout steps.
  const ref = req.nextUrl.searchParams.get('ref')
  const validRef = ref ? /^[A-Za-z0-9]{4,12}$/.test(ref) : false
  const isEmbed = req.nextUrl.searchParams.get('channel') === 'embed'
  if (validRef || isEmbed) {
    const res = NextResponse.next({ request: { headers } })
    if (validRef) {
      res.cookies.set('ref', ref!.toUpperCase(), { maxAge: 60 * 60 * 24 * 30, path: '/', sameSite: 'lax' })
    }
    if (isEmbed) {
      res.cookies.set('mi_channel', 'embed', { maxAge: 60 * 60 * 2, path: '/', sameSite: 'lax' })
    }
    return res
  }

  // Default platform response — forward the sanitized headers so spoofed
  // x-miyagi-* trust headers never reach the page render.
  return NextResponse.next({ request: { headers } })
})

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
