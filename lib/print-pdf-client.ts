/**
 * Shared client for the standalone Cloud Run PDF renderer (US-5b): headless
 * Chromium loads one of our `/…/print` render pages and streams back a
 * print-ready PDF. Every `/api/.../pdf` route proxies through this one
 * function so the env-var / error-shape contract never drifts between
 * callers (the edition PDF export, and Sprint 5's rate-card PDF).
 */
import 'server-only'

export interface RenderPrintPdfResult {
  ok: boolean
  /** HTTP status the caller should surface (503 = not configured, 502 = render failed). */
  status?: number
  buffer?: ArrayBuffer
  error?: string
}

export async function renderPrintPdf(printUrl: string): Promise<RenderPrintPdfResult> {
  const service = process.env.PRINT_PDF_URL
  const secret = process.env.PRINT_PDF_SECRET
  if (!service || !secret) {
    return { ok: false, status: 503, error: 'Servicio PDF no configurado (PRINT_PDF_URL / PRINT_PDF_SECRET).' }
  }

  let r: Response
  try {
    r = await fetch(`${service.replace(/\/$/, '')}/pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret },
      body: JSON.stringify({ url: printUrl }),
    })
  } catch (e) {
    return { ok: false, status: 502, error: `No se pudo contactar el servicio PDF: ${(e as Error).message}` }
  }
  if (!r.ok) {
    const msg = await r.text().catch(() => '')
    return { ok: false, status: 502, error: `Render falló (${r.status}): ${msg.slice(0, 300)}` }
  }

  return { ok: true, buffer: await r.arrayBuffer() }
}
