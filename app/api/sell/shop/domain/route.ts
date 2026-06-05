/**
 * POST   /api/sell/shop/domain  — save custom domain + provision on Vercel
 * GET    /api/sell/shop/domain  — check DNS verification status
 * DELETE /api/sell/shop/domain  — remove custom domain
 *
 * All endpoints require auth. The shop must belong to the authenticated user.
 */

import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import {
  addDomainToProject,
  getDomainStatus,
  removeDomainFromProject,
  DomainConflictError,
} from '@/lib/vercel-domains'
import { CNAME_TARGET, APEX_A_RECORD, isApexDomain } from '@/lib/domain-utils'
import dns from 'dns/promises'

// ── helpers ──────────────────────────────────────────────────────────────────

async function getShopForUser(clerkUserId: string) {
  const { data } = await db
    .from('marketplace_shops')
    .select('id, slug, custom_domain, custom_domain_verified, custom_domain_vercel_ok')
    .eq('clerk_user_id', clerkUserId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return data
}

/**
 * Server-side DNS check — the source of truth for "live". Resolves on the
 * server so we get a real answer the browser can't fake.
 *
 * `dns_ok` is true when the domain points at Vercel by EITHER path:
 *  - a CNAME to `cname.vercel-dns.com` (the only valid setup for a subdomain), or
 *  - an A record resolving to Vercel's anycast IP — which also covers an apex
 *    using Cloudflare's CNAME-flattening (it surfaces as that A record).
 * `cname_current` is kept for diagnostics: if a CNAME exists but points
 * elsewhere, the UI can tell the seller exactly what to fix.
 */
async function checkDns(domain: string): Promise<{ dns_ok: boolean; cname_current: string | null }> {
  let cname_current: string | null = null
  try {
    const records = await dns.resolveCname(domain)
    cname_current = records[0] ?? null
  } catch {
    // No CNAME (apex A-record setups have none) or domain doesn't exist yet.
  }

  if (cname_current === CNAME_TARGET) return { dns_ok: true, cname_current }

  // Apex (and CNAME-flattened) domains resolve to Vercel's A record.
  if (isApexDomain(domain)) {
    try {
      const a = await dns.resolve4(domain)
      if (a.includes(APEX_A_RECORD)) return { dns_ok: true, cname_current }
    } catch {
      // No A record yet.
    }
  }

  return { dns_ok: false, cname_current }
}

// ── POST — save domain & provision on Vercel ─────────────────────────────────

export async function POST(req: NextRequest) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  let body: { domain: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }

  const raw = (body.domain ?? '').trim().toLowerCase()
    .replace(/^https?:\/\//, '')   // strip protocol if pasted
    .replace(/\/.*$/, '')          // strip path
  if (!raw || raw.length < 4) {
    return NextResponse.json({ error: 'Dominio inválido.' }, { status: 400 })
  }
  // Basic domain format validation
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(raw)) {
    return NextResponse.json({ error: 'Formato de dominio inválido.' }, { status: 400 })
  }

  const shop = await getShopForUser(user.id)
  if (!shop) return NextResponse.json({ error: 'Tienda no encontrada.' }, { status: 404 })

  // Check if another shop already claimed this domain
  const { data: existing } = await db
    .from('marketplace_shops')
    .select('id')
    .eq('custom_domain', raw)
    .neq('id', shop.id)
    .maybeSingle()
  if (existing) {
    return NextResponse.json({ error: 'Este dominio ya está en uso por otra tienda.' }, { status: 409 })
  }

  // Register domain on Vercel project
  let vercelStatus
  try {
    vercelStatus = await addDomainToProject(raw)
  } catch (err) {
    // Domain already registered to a different Vercel account/project → clear 409.
    if (err instanceof DomainConflictError) {
      return NextResponse.json(
        { error: 'Este dominio ya está en uso. Si es tuyo, contáctanos para liberarlo.' },
        { status: 409 },
      )
    }
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[domain] Vercel addDomain failed:', msg)
    return NextResponse.json({ error: 'Error al registrar el dominio en Vercel.', detail: msg }, { status: 502 })
  }

  // Save to DB
  await db
    .from('marketplace_shops')
    .update({
      custom_domain: raw,
      custom_domain_vercel_ok: true,
      custom_domain_verified: vercelStatus.verified,
    })
    .eq('id', shop.id)

  // Replace flow: the new domain is now saved, so release the previous one from
  // Vercel to avoid orphaned domains on the project. Best-effort — never block.
  const previous = shop.custom_domain
  if (previous && previous !== raw) {
    try {
      await removeDomainFromProject(previous)
    } catch (err) {
      console.error('[domain] Vercel removeDomain (replace) failed:', err)
    }
  }

  return NextResponse.json({
    domain: raw,
    verified: vercelStatus.verified,
    cname_target: vercelStatus.cname_target,
    verification: vercelStatus.verification,
  })
}

// ── GET — check DNS + Vercel verification status ──────────────────────────────

export async function GET(req: NextRequest) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const shop = await getShopForUser(user.id)
  if (!shop) return NextResponse.json({ error: 'Tienda no encontrada.' }, { status: 404 })

  const domain = shop.custom_domain
  if (!domain) return NextResponse.json({ domain: null, verified: false })

  // Check Vercel's view of the domain
  let vercelStatus
  try {
    vercelStatus = await getDomainStatus(domain)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[domain] Vercel getDomainStatus failed:', msg)
    return NextResponse.json({ error: 'Error al verificar el dominio.', detail: msg }, { status: 502 })
  }

  // Live DNS lookup — this is the only source of truth for "live".
  // Vercel's `verified` field just means "domain is registered on the project"
  // (and, once true, that the SSL cert is issued) — NOT that DNS is live. Only
  // update DB when our own lookup confirms the domain points at us.
  const { dns_ok, cname_current } = await checkDns(domain)

  if (dns_ok && !shop.custom_domain_verified) {
    // DNS just went live — mark verified in DB
    await db
      .from('marketplace_shops')
      .update({ custom_domain_verified: true })
      .eq('id', shop.id)
  } else if (!dns_ok && shop.custom_domain_verified) {
    // DNS was live but is no longer pointing to us (seller changed registrar etc.)
    await db
      .from('marketplace_shops')
      .update({ custom_domain_verified: false })
      .eq('id', shop.id)
  }

  return NextResponse.json({
    domain,
    verified: vercelStatus.verified,
    dns_ok,
    cname_target: vercelStatus.cname_target,
    cname_current,
    verification: vercelStatus.verification,
  })
}

// ── DELETE — remove domain ───────────────────────────────────────────────────

export async function DELETE(_req: NextRequest) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const shop = await getShopForUser(user.id)
  if (!shop) return NextResponse.json({ error: 'Tienda no encontrada.' }, { status: 404 })

  const domain = shop.custom_domain
  if (!domain) return NextResponse.json({ ok: true })

  try {
    await removeDomainFromProject(domain)
  } catch (err) {
    // Log but don't block — always clear from DB even if Vercel call fails
    console.error('[domain] Vercel removeDomain failed:', err)
  }

  await db
    .from('marketplace_shops')
    .update({
      custom_domain: null,
      custom_domain_verified: false,
      custom_domain_vercel_ok: false,
    })
    .eq('id', shop.id)

  return NextResponse.json({ ok: true })
}
