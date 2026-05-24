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
} from '@/lib/vercel-domains'
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

/** Lightweight DNS CNAME check — resolves on the server so we get a real answer */
async function checkCname(domain: string): Promise<string | null> {
  try {
    const records = await dns.resolveCname(domain)
    return records[0] ?? null
  } catch {
    // CNAME not set or domain doesn't exist yet
    return null
  }
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

  // Live DNS CNAME lookup — this is the only source of truth for "verified"
  // Vercel's `verified` field just means "domain is registered on the project"
  // — NOT that DNS is live. Only update DB when our own lookup confirms it.
  const cname_current = await checkCname(domain)
  const dns_ok = cname_current === 'cname.vercel-dns.com'

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
