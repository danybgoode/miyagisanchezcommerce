/**
 * GET /api/sell/shop/domain/detect?domain=tutienda.mx
 *
 * Performs an NS lookup on the root domain and returns a detected registrar.
 * Used by the frontend to show context-aware DNS setup instructions.
 *
 * No auth required — it's a read-only DNS lookup on a public domain.
 */

import { NextRequest, NextResponse } from 'next/server'
import dns from 'dns/promises'

export const dynamic = 'force-dynamic'

export type RegistrarKey = 'cloudflare' | 'godaddy' | 'namecheap' | 'google' | 'squarespace' | 'unknown'

function detectRegistrar(ns: string[]): RegistrarKey {
  const lower = ns.map(n => n.toLowerCase())
  if (lower.some(n => n.endsWith('.ns.cloudflare.com')))                        return 'cloudflare'
  if (lower.some(n => n.includes('domaincontrol.com')))                         return 'godaddy'
  if (lower.some(n => n.includes('registrar-servers.com') || n.includes('namecheap'))) return 'namecheap'
  if (lower.some(n => n.includes('squarespace')))                               return 'squarespace'
  if (lower.some(n => n.includes('googledomains') || n.includes('google')))     return 'google'
  return 'unknown'
}

export async function GET(req: NextRequest) {
  const domain = req.nextUrl.searchParams.get('domain')?.trim().toLowerCase()
  if (!domain) return NextResponse.json({ error: 'domain required' }, { status: 400 })

  // Extract root domain for NS lookup (strip subdomains; NS lives at zone apex)
  const parts = domain.split('.')
  const rootDomain = parts.length > 2 ? parts.slice(-2).join('.') : domain

  try {
    const ns = await Promise.race([
      dns.resolveNs(rootDomain),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ]) as string[]

    return NextResponse.json({ registrar: detectRegistrar(ns), ns, domain: rootDomain })
  } catch {
    // Non-fatal: propagation may not have started, domain may not exist yet
    return NextResponse.json({ registrar: 'unknown', ns: [], domain: rootDomain })
  }
}
