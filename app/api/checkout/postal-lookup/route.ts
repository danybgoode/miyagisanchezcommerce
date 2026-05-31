/**
 * POST /api/checkout/postal-lookup
 *
 * Wraps the Envia Geocodes API to resolve a Mexican postal code into
 * a canonical state code, municipio, and colonia list.
 *
 * No auth required — CP→location is public data.
 * Body: { cp: string }
 * Returns: PostalLookupResult | { error: string }
 */
import { NextRequest, NextResponse } from 'next/server'
import { lookupPostalCode } from '@/lib/envia'

export async function POST(req: NextRequest) {
  let body: { cp?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }

  const cp = (body.cp ?? '').replace(/\D/g, '').slice(0, 5)
  if (cp.length < 4) {
    return NextResponse.json({ error: 'Escribe un código postal válido (5 dígitos).' }, { status: 422 })
  }

  const result = await lookupPostalCode(cp)
  if (!result) {
    return NextResponse.json({ error: 'Código postal no encontrado. Verifica e intenta de nuevo.' }, { status: 404 })
  }

  return NextResponse.json(result)
}
