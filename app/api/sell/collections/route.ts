import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const PUB_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

function medusaFetch(path: string, clerkJwt: string, options?: RequestInit) {
  return fetch(`${MEDUSA_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-publishable-api-key': PUB_KEY,
      Authorization: `Bearer ${clerkJwt}`,
      ...(options?.headers ?? {}),
    },
  })
}

// GET /api/sell/collections — list the seller's collections (proxied to Medusa)
export async function GET() {
  const { userId, getToken } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })
  const clerkJwt = await getToken()
  if (!clerkJwt) return NextResponse.json({ error: 'Error de autenticación.' }, { status: 401 })

  const res = await medusaFetch('/store/sellers/me/collections', clerkJwt)
  const data = await res.json().catch(() => ({}))
  return NextResponse.json(data, { status: res.status })
}

// POST /api/sell/collections — create a collection
export async function POST(req: NextRequest) {
  const { userId, getToken } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })
  const clerkJwt = await getToken()
  if (!clerkJwt) return NextResponse.json({ error: 'Error de autenticación.' }, { status: 401 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 }) }

  const res = await medusaFetch('/store/sellers/me/collections', clerkJwt, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  return NextResponse.json(data, { status: res.status })
}
