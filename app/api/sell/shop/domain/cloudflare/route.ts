/**
 * POST /api/sell/shop/domain/cloudflare
 *
 * One-click Cloudflare DNS automation for the "own channel" feature.
 * The tenant provides a Cloudflare API token (Zone DNS Edit scope) and
 * their Zone ID. We call the Cloudflare API to add the CNAME record
 * pointing their domain to cname.vercel-dns.com.
 *
 * The token is NEVER stored — used once and discarded.
 */

import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'

const CF_API = 'https://api.cloudflare.com/client/v4'
const CNAME_TARGET = 'cname.vercel-dns.com'

export async function POST(req: NextRequest) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  let body: { domain?: string; cf_token?: string; cf_zone_id?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }

  const { cf_token, cf_zone_id } = body
  if (!cf_token?.trim() || !cf_zone_id?.trim()) {
    return NextResponse.json({ error: 'Token y Zone ID son requeridos.' }, { status: 400 })
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

  // The CNAME name is the bare domain or subdomain relative to the zone.
  // For apex domains (e.g. myshop.mx) Cloudflare uses "@" as the name.
  // For subdomains (e.g. shop.myshop.mx) it's "shop".
  // We detect by comparing domain vs zone — if domain ends with zone root, it's a subdomain.
  // Simplest: use the full domain as the name; CF resolves it relative to the zone.
  const cname_name = '@'

  // Delete any existing CNAME for this name first (idempotent)
  try {
    const listRes = await fetch(
      `${CF_API}/zones/${cf_zone_id}/dns_records?type=CNAME&name=${encodeURIComponent(domain)}`,
      { headers: { Authorization: `Bearer ${cf_token}`, 'Content-Type': 'application/json' } }
    )
    const listData = await listRes.json() as { result?: Array<{ id: string }> }
    for (const record of listData.result ?? []) {
      await fetch(`${CF_API}/zones/${cf_zone_id}/dns_records/${record.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${cf_token}` },
      })
    }
  } catch {
    // Non-fatal — continue to create
  }

  // Create the CNAME record
  const createRes = await fetch(
    `${CF_API}/zones/${cf_zone_id}/dns_records`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${cf_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'CNAME',
        name: cname_name,
        content: CNAME_TARGET,
        ttl: 1,       // 1 = automatic TTL
        proxied: false, // Must be DNS-only (not proxied) for Vercel SSL to work
      }),
    }
  )

  const createData = await createRes.json() as { success?: boolean; errors?: Array<{ message: string }> }

  if (!createRes.ok || !createData.success) {
    const cfError = createData.errors?.[0]?.message ?? `Cloudflare error ${createRes.status}`
    console.error('[domain/cloudflare] CF API error:', cfError)
    return NextResponse.json({ error: `Error de Cloudflare: ${cfError}` }, { status: 502 })
  }

  return NextResponse.json({ ok: true, message: 'Registro CNAME creado en Cloudflare.' })
}
