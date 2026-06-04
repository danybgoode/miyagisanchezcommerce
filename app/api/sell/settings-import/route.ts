import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { revalidateTag } from 'next/cache'
import { type StoreConfigManifest } from '@/lib/settings-import'
import { applyStoreConfig } from '@/lib/apply-config-manifest'

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

  // Validate + ingest assets + atomic apply — shared with the MCP patch tool.
  const clerkJwt = await getToken()
  const result = await applyStoreConfig(userId, clerkJwt, manifest as StoreConfigManifest)
  if (!result.ok) {
    // 422 when nothing validated; 500 when a valid apply failed downstream.
    return NextResponse.json(
      { blocks: result.blocks, error: result.error },
      { status: result.appliedAny ? 500 : 422 },
    )
  }

  // Refresh storefront/PDP caches so the new settings show immediately.
  revalidateTag('listings', 'default')
  revalidateTag('shops', 'default')

  return NextResponse.json({ ok: true, blocks: result.blocks })
}
