/**
 * POST /api/sell/shop/domain/cloudflare
 *
 * One-click Cloudflare DNS automation for the "own channel" feature.
 * The tenant provides only a Cloudflare API token (Zone DNS Edit scope).
 * We auto-detect their Zone ID via GET /zones?name={domain} — no Zone ID entry needed.
 *
 * The token is NEVER stored — used once and discarded.
 */

import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'

const CF_API = 'https://api.cloudflare.com/client/v4'
const CNAME_TARGET = 'cname.vercel-dns.com'

async function cfGet(path: string, token: string) {
  const res = await fetch(`${CF_API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  return res
}

async function cfPost(path: string, token: string, body: unknown) {
  const res = await fetch(`${CF_API}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res
}

async function cfDelete(path: string, token: string) {
  const res = await fetch(`${CF_API}${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  return res
}

export async function POST(req: NextRequest) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  let body: { cf_token?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }

  const cf_token = body.cf_token?.trim()
  if (!cf_token) {
    return NextResponse.json({ error: 'API Token de Cloudflare requerido.' }, { status: 400 })
  }

  // Verify the shop belongs to this user and get the saved domain
  const { data: shop } = await db
    .from('marketplace_shops')
    .select('id, custom_domain')
    .eq('clerk_user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!shop) return NextResponse.json({ error: 'Tienda no encontrada.' }, { status: 404 })

  const domain = (shop as unknown as { custom_domain: string | null }).custom_domain
  if (!domain) {
    return NextResponse.json({ error: 'Primero guarda tu dominio personalizado.' }, { status: 400 })
  }

  // ── Step 1: Auto-detect Zone ID ───────────────────────────────────────────
  // Extract root domain for zone lookup
  const parts = domain.split('.')
  const rootDomain = parts.length > 2 ? parts.slice(-2).join('.') : domain

  const zonesRes = await cfGet(`/zones?name=${encodeURIComponent(rootDomain)}&status=active`, cf_token)
  const zonesData = await zonesRes.json() as {
    success?: boolean
    result?: Array<{ id: string; name: string }>
    errors?: Array<{ message: string }>
  }

  if (!zonesRes.ok || !zonesData.success) {
    const cfError = zonesData.errors?.[0]?.message ?? `Cloudflare error ${zonesRes.status}`
    console.error('[domain/cloudflare] Zone lookup failed:', cfError)
    // Give a friendly error — most likely the token is wrong or has wrong scope
    return NextResponse.json({
      error: `No pudimos verificar tu token de Cloudflare. Asegúrate de que el token tenga el permiso Zone · DNS · Edit.`,
    }, { status: 401 })
  }

  const zone = zonesData.result?.[0]
  if (!zone) {
    return NextResponse.json({
      error: `No encontramos la zona "${rootDomain}" en tu cuenta de Cloudflare. Verifica que este dominio esté en tu cuenta y el token tenga acceso a él.`,
    }, { status: 404 })
  }

  const zoneId = zone.id

  // ── Step 2: Remove any existing CNAME for this domain name ──────────────
  try {
    const listRes = await cfGet(
      `/zones/${zoneId}/dns_records?type=CNAME&name=${encodeURIComponent(domain)}`,
      cf_token,
    )
    const listData = await listRes.json() as { result?: Array<{ id: string }> }
    for (const record of listData.result ?? []) {
      await cfDelete(`/zones/${zoneId}/dns_records/${record.id}`, cf_token)
    }
  } catch {
    // Non-fatal — continue to create
  }

  // ── Step 3: Create the CNAME record ─────────────────────────────────────
  const createRes = await cfPost(`/zones/${zoneId}/dns_records`, cf_token, {
    type: 'CNAME',
    name: '@',
    content: CNAME_TARGET,
    ttl: 1,       // 1 = automatic TTL
    proxied: false, // Must be DNS-only (not proxied) for Vercel SSL to work
  })

  const createData = await createRes.json() as {
    success?: boolean
    errors?: Array<{ message: string }>
  }

  if (!createRes.ok || !createData.success) {
    const cfError = createData.errors?.[0]?.message ?? `Cloudflare error ${createRes.status}`
    console.error('[domain/cloudflare] Create record failed:', cfError)
    return NextResponse.json({ error: `Error de Cloudflare: ${cfError}` }, { status: 502 })
  }

  return NextResponse.json({
    ok: true,
    message: 'Registro CNAME creado en Cloudflare.',
    zone_id: zoneId,
    zone_name: zone.name,
  })
}
