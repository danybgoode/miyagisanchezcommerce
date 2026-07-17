import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { shopSlugFromHost, ROOT_DOMAIN } from '@/lib/subdomain'
import { pickAliasTarget, type PreviousSlug } from '@/lib/slug'
import {
  isShortLinkHost, firstSegment, shopTarget, listingTarget, HOME_TARGET, NOT_FOUND_TARGET,
  passthroughTarget,
} from '@/lib/shortlink'
import { isLikelyListingId, isLikelyShopSlug, isBoundaryDeniedPath } from '@/lib/route-shape'
import { resolveSubdomainEntitlement } from '@/lib/subdomain-entitlement-server'

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
  // Cloudflare→ALB→Cloud Run staging hostname (09-platform-infra
  // frontend-vercel-to-cloudrun, S2.2). NOTE: this alone is not sufficient —
  // 'gcp' must ALSO be in lib/subdomain.ts's INFRA_SUBDOMAINS, since
  // shopSlugFromHost() runs BEFORE this check and would otherwise treat it as
  // a shop-slug lookup first. Both gates are load-bearing (found live: with
  // only one of the two, the request still 404s "Shop not found" — either as
  // an unknown subdomain, or as an unknown custom domain).
  'gcp.miyagisanchez.com',
]

function isPlatformHost(hostname: string): boolean {
  if (PLATFORM_HOSTS.some(h => hostname === h || hostname.startsWith(h + ':'))) return true
  // Vercel preview / branch URLs
  if (hostname.endsWith('.vercel.app')) return true
  // Cloud Run's default dark URL (09-platform-infra frontend-vercel-to-cloudrun,
  // S1.3/S1.4) — same reasoning as .vercel.app: a platform-served preview host,
  // not a tenant custom domain, before Cloudflare fronts the real domain (S2+).
  if (hostname.endsWith('.run.app')) return true
  return false
}

export default clerkMiddleware(async (auth, req: NextRequest) => {
  const hostname = req.headers.get('host') ?? ''

  // ── Subdomain channel: <slug>.miyagisanchez.com ──────────────────────────
  // A shop's slug doubles as a free subdomain. Resolve it and serve the WHOLE
  // storefront white-label (same machinery as a custom domain), tagged
  // `x-miyagi-channel: subdomain`. The apex, www, Vercel previews, and reserved/
  // infra labels (clerk, accounts, api…) return null here and fall through to the
  // normal platform/custom-domain handling untouched.
  const subSlug = shopSlugFromHost(hostname)
  if (subSlug) {
    let slug: string | null = null
    let shopMetadata: unknown = null
    let shopClerkId: string | null = null
    let redirectTo: string | null = null
    try {
      const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
      const { data: shop } = await supabase
        .from('marketplace_shops')
        .select('slug, metadata, clerk_user_id')
        .eq('slug', subSlug)
        .maybeSingle()
      slug = shop?.slug ?? null
      shopMetadata = shop?.metadata ?? null
      shopClerkId = (shop?.clerk_user_id as string | null) ?? null
      if (!slug) {
        // Maybe a retired slug — look it up in the alias history (same store as
        // the /s/[slug] redirect). Inline (no unstable_cache — invalid here).
        const { data: aliasRow } = await supabase
          .from('marketplace_shops')
          .select('slug, metadata')
          .contains('metadata', { previous_slug_keys: [subSlug] })
          .limit(1)
          .maybeSingle()
        if (aliasRow?.slug) {
          const prev = ((aliasRow.metadata as Record<string, unknown> | null)?.previous_slugs ?? []) as PreviousSlug[]
          redirectTo = pickAliasTarget(String(aliasRow.slug), prev, subSlug)
        }
      }
    } catch {
      // DB unreachable → treat as unresolved (clean 404 below); never 500 a hit.
    }

    // Retired slug → 301 to the current shop's subdomain.
    if (!slug && redirectTo) {
      const url = req.nextUrl.clone()
      url.protocol = 'https:'
      url.host = `${redirectTo}.${ROOT_DOMAIN}`
      url.pathname = '/'
      url.search = ''
      return NextResponse.redirect(url, 301)
    }

    if (slug) {
      // ── Subdomain paywall gate (epic 07 · subdomain-pricing, US-1 + US-4) ──
      // The white-label subdomain is a paid SKU. When the paywall is ON and this
      // shop isn't entitled (no grandfather/comp grant, no LIVE one-time grant, and
      // no active recurring subscription — US-4), 301 the WHOLE subdomain to the
      // free `/s/slug` on the apex — the subdomain is honestly the upgrade it isn't
      // paying for. The flag is fail-open OFF (today's free-for-all), so a flag
      // outage never traps a seller or breaks a live subdomain.
      //
      // `resolveSubdomainEntitlement` short-circuits the Medusa subscription read
      // unless it's actually needed (paywall on AND no entitling grant), so the 179
      // grandfathered shops add zero round-trip — identical perf to Sprint 1; only a
      // non-grandfathered shop that bought the recurring plan triggers the lookup.
      // The flag + subscription reads are WHY the middleware runs on the Node runtime
      // — lib/flags.ts + the Medusa bridge are not Edge-compatible (see `config`).
      const { entitled } = await resolveSubdomainEntitlement(shopMetadata, {
        sellerClerkId: shopClerkId ?? undefined,
      })
      if (!entitled) {
        const url = req.nextUrl.clone()
        url.protocol = 'https:'
        url.host = ROOT_DOMAIN
        url.pathname = `/s/${slug}`
        url.search = ''
        return NextResponse.redirect(url, 301)
      }

      // Boundary isolation (same as custom domains): a subdomain serves ONLY its
      // own shop — never expose /s/ or the cross-shop /l index here.
      const path = req.nextUrl.pathname
      if (isBoundaryDeniedPath(path)) {
        const home = req.nextUrl.clone()
        home.pathname = '/'
        home.search = ''
        return NextResponse.redirect(home)
      }

      const headers = new Headers(req.headers)
      headers.set('x-miyagi-channel', 'subdomain')
      headers.set('x-miyagi-domain', hostname.split(':')[0].toLowerCase())
      headers.set('x-miyagi-shop-slug', slug)

      // Homepage → render the shop landing page (transparent rewrite, slug never
      // exposed). LOAD-BEARING for the static-marketplace-shell split: the bare `/`
      // route is owned solely by the static `app/(site)/page.tsx`, while channel
      // homepages are rewritten to `/s/[slug]` — which lands in the dynamic
      // `app/(shell)/` tree and renders the white-label ChannelLayout. So the two
      // layouts never contend for `/`, and `/` can be a static CDN asset.
      if (path === '/') {
        const url = req.nextUrl.clone()
        url.pathname = `/s/${slug}`
        return NextResponse.rewrite(url, { request: { headers } })
      }
      // Bookshop launchpad convocatoria — serve the shop's submission portal
      // natively at `/convocatoria` (white-label), keeping the subdomain in the
      // bar (transparent rewrite; the `/s/…` form is boundary-denied above).
      if (path === '/convocatoria') {
        const url = req.nextUrl.clone()
        url.pathname = `/s/${slug}/convocatoria`
        return NextResponse.rewrite(url, { request: { headers } })
      }
      return NextResponse.next({ request: { headers } })
    }

    // Well-formed but unknown subdomain → clean 404 (don't fall through to the
    // custom-domain branch, which would look up a custom_domain that can't exist).
    return new NextResponse(
      '<!doctype html><html><head><title>Not found</title></head><body><p>Shop not found.</p></body></html>',
      { status: 404, headers: { 'Content-Type': 'text/html' } },
    )
  }

  // ── Short links: mschz.org/[x] ───────────────────────────────────────────
  // Ultra-short branded redirector. Resolve the first path segment and 301 to the
  // canonical storefront URL (shop slug → retired alias → product short-slug →
  // product short-code); empty → home; unknown → branded 404. We target the
  // platform canonical (/s/[slug], /l/[id]) and let those pages handle any custom-
  // domain consolidation. Inline lookups (no unstable_cache in middleware).
  if (isShortLinkHost(hostname)) {
    const seg = firstSegment(req.nextUrl.pathname)
    if (!seg) return NextResponse.redirect(HOME_TARGET, 301)

    // ── Known-prefix passthrough (mschz-full-coverage, Sprint 1, US-1.1) ──────
    // Multi-segment paths whose first segment is an allowlisted public prefix
    // (g/e/v/s/l — sweepstakes, events, launchpad voting, shops+subpages,
    // listings) 301 to the IDENTICAL path + query on the platform origin, before
    // the flat single-segment resolver below ever runs. Single-segment paths
    // (the existing flat namespace) are completely unaffected — this branch is
    // gated on segment count, not just the prefix letter. Non-allowlisted
    // multi-segment paths (e.g. /checkout/x, /shop/manage) fall through to the
    // same branded 404 as an unknown flat segment (Daniel-decided carve-out,
    // 2026-07-09 — pure additive 301 allowlist, no flag needed).
    const isMultiSegment = req.nextUrl.pathname.split('/').filter(Boolean).length > 1
    if (isMultiSegment) {
      const target = passthroughTarget(req.nextUrl.pathname, req.nextUrl.search)
      return NextResponse.redirect(target ?? NOT_FOUND_TARGET, 301)
    }

    let target: string | null = null
    try {
      const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
      // 1) Live shop slug.
      const { data: shop } = await supabase
        .from('marketplace_shops').select('slug').eq('slug', seg).maybeSingle()
      if (shop?.slug) {
        target = shopTarget(shop.slug)
      } else {
        // 2) Retired shop slug (90-day alias).
        const { data: aliasShop } = await supabase
          .from('marketplace_shops').select('slug, metadata')
          .contains('metadata', { previous_slug_keys: [seg] }).limit(1).maybeSingle()
        if (aliasShop?.slug) {
          const prev = ((aliasShop.metadata as Record<string, unknown> | null)?.previous_slugs ?? []) as PreviousSlug[]
          const current = pickAliasTarget(String(aliasShop.slug), prev, seg)
          if (current) target = shopTarget(current)
        }
        // 3) Product custom slug, then short code.
        if (!target) {
          const { data: bySlug } = await supabase
            .from('marketplace_listings').select('medusa_product_id')
            .contains('metadata', { short_slug: seg }).limit(1).maybeSingle()
          const { data: byCode } = bySlug ? { data: bySlug } : await supabase
            .from('marketplace_listings').select('medusa_product_id')
            .contains('metadata', { short_code: seg }).limit(1).maybeSingle()
          if (byCode?.medusa_product_id) target = listingTarget(String(byCode.medusa_product_id))
        }
      }
    } catch {
      // DB unreachable → fall through to the branded 404 (never 500 a hit).
    }

    return NextResponse.redirect(target ?? NOT_FOUND_TARGET, 301)
  }

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
      if (isBoundaryDeniedPath(path)) {
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
      // the address bar (transparent rewrite, slug never exposed). Same load-bearing
      // role as the subdomain rewrite above: it keeps channel homepages off the bare
      // `/` route so `app/(site)/page.tsx` can stay a static CDN asset while this
      // request renders the dynamic white-label `(shell)` tree.
      if (path === '/') {
        const url = req.nextUrl.clone()
        url.pathname = `/s/${slug}`
        return NextResponse.rewrite(url, { request: { headers } })
      }
      // Bookshop launchpad convocatoria — serve the shop's submission portal
      // natively at `/convocatoria` (white-label), keeping the custom domain in
      // the bar (transparent rewrite; the `/s/…` form is boundary-denied above).
      if (path === '/convocatoria') {
        const url = req.nextUrl.clone()
        url.pathname = `/s/${slug}/convocatoria`
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

  // ── Cheap, cached 404 for clearly-malformed listing/shop URLs ─────────────
  // Scanners hammering dead/junk paths (`/l/.env`, `/s/wp-login.php`, …) were the
  // #1 source of `/_not-found` function invocations + Fluid Active CPU (epic 09 ·
  // cost reduction S2.2). A segment that can't be shaped like a real Medusa
  // product id / shop slug can never resolve, so we 404 it HERE — before the page
  // function is invoked — and attach a long edge-cache header so repeat hits are
  // served by the CDN, not the function. Single-segment only (`/l/x`, `/s/x`), so
  // the `/l` index and `/s/[slug]/claim` sub-route pass through untouched.
  // Well-formed-but-deleted ids/slugs (and retired-slug 301s) are NOT caught here
  // — they flow to the page, which 404s/redirects them normally. The page guards
  // share these same lib/route-shape predicates (defense-in-depth + channel hosts).
  const platformPath = req.nextUrl.pathname
  const listingSeg = /^\/l\/([^/]+)\/?$/.exec(platformPath)
  const shopSeg = /^\/s\/([^/]+)\/?$/.exec(platformPath)
  if (
    (listingSeg && !isLikelyListingId(listingSeg[1])) ||
    (shopSeg && !isLikelyShopSlug(shopSeg[1]))
  ) {
    return new NextResponse(
      '<!doctype html><html><head><title>Not found</title></head><body><p>Not found.</p></body></html>',
      {
        status: 404,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          // s-maxage caches at the CDN edge only (not browsers); a malformed URL
          // never becomes valid, so a long TTL is safe and serves repeats for free.
          'Cache-Control': 'public, s-maxage=86400',
        },
      },
    )
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
  // `?promo=PRM-CODE` from a promoter's share link → 30-day cookie, read later by
  // /api/promoter/attribute to credit the promoter (epic 08). Distinct namespace
  // from `ref` so a promoter code never collides with a buyer referral code.
  const promo = req.nextUrl.searchParams.get('promo')
  const validPromo = promo ? /^PRM-[A-Za-z0-9]{4,12}$/i.test(promo) : false
  const isEmbed = req.nextUrl.searchParams.get('channel') === 'embed'
  if (validRef || validPromo || isEmbed) {
    const res = NextResponse.next({ request: { headers } })
    if (validRef) {
      res.cookies.set('ref', ref!.toUpperCase(), { maxAge: 60 * 60 * 24 * 30, path: '/', sameSite: 'lax' })
    }
    if (validPromo) {
      res.cookies.set('promo', promo!.toUpperCase(), { maxAge: 60 * 60 * 24 * 30, path: '/', sameSite: 'lax' })
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
  // Node.js runtime (not the Edge default): the subdomain paywall gate reads the
  // flag via lib/flags.ts (the in-house Supabase-backed reader, `server-only`), which
  // is NOT Edge-compatible. The Node runtime lets middleware read platform_flags (no
  // Vercel-proprietary Edge Config) with cached ~0ms/request reads + ~60s flip propagation.
  // (epic 07 · subdomain-pricing, US-1 — Daniel-approved; shared-surface change.)
  runtime: 'nodejs',
  matcher: [
    // Skip Next.js internals and static files
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
