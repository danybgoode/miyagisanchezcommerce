import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { revalidateTag } from 'next/cache'
import { validateConfig, type StoreConfigManifest } from '@/lib/settings-import'
import { applyShopSettings } from '@/lib/apply-shop-settings'

/**
 * POST /api/sell/settings-import  (Storefront-as-Code, Sprint 3)
 *
 * Body: { manifest: StoreConfigManifest }
 * Validates the manifest server-side block-by-block, applies the valid blocks
 * atomically (one merged write), and returns a per-block delta report. Invalid
 * fields are dropped (reported); a malformed block never blocks the valid ones.
 */
export async function POST(req: NextRequest) {
  const { userId, getToken } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  let body: { manifest?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }

  const manifest = body.manifest
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return NextResponse.json({ error: 'El archivo debe ser un objeto JSON de configuración.' }, { status: 422 })
  }

  // Re-validate server-side — never trust the client.
  const { blocks, patch } = validateConfig(manifest as StoreConfigManifest)
  const appliedBlocks = blocks.filter((b) => b.status === 'applied')

  if (appliedBlocks.length === 0) {
    return NextResponse.json(
      { blocks, error: 'No encontramos configuración válida para aplicar. Revisa el archivo.' },
      { status: 422 },
    )
  }

  const clerkJwt = await getToken()
  const result = await applyShopSettings(userId, clerkJwt, patch)
  if (!result.ok) {
    return NextResponse.json({ blocks, error: result.error ?? 'No se pudo aplicar la configuración.' }, { status: 500 })
  }

  // Refresh storefront/PDP caches so the new settings show immediately.
  revalidateTag('listings', 'default')
  revalidateTag('shops', 'default')

  return NextResponse.json({ ok: true, blocks })
}
