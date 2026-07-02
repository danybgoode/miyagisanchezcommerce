'use client'

import { useEffect, useState } from 'react'

/**
 * "Conecta tu agente" — the reusable per-shop MCP token + config helper.
 *
 * Two credentials, one panel:
 *  - The **personal MCP URL** (Sprint 2 of seller-agent-connect-mcp-url) — always
 *    shown, no button press, because claude.ai's custom-connector modal only
 *    accepts a URL (no Bearer-header field). Backed by
 *    GET/POST/DELETE `/api/sell/agent-connector`, gated by the
 *    `seller_agent.connector_url_enabled` kill-switch — a 404 (flag off) falls
 *    back to legacy-only, so this component degrades gracefully with zero
 *    special-casing by the caller.
 *  - The existing **Bearer token** (POST/DELETE `/api/sell/agent-token`) — unchanged,
 *    for Claude Desktop / CLI / other MCP clients that DO support a header.
 *
 * Self-contained so it can be dropped onto the first-run success screen as well as
 * the seller settings page.
 */

const MCP_URL = 'https://miyagisanchez.com/api/ucp/mcp'
const TOKEN_PLACEHOLDER = 'PEGA_TU_TOKEN_AQUÍ'
const ADD_TO_CLAUDE_URL = 'https://claude.ai/customize/connectors?modal=add-custom-connector'

function mcpSnippet(token: string): string {
  return `{
  "mcpServers": {
    "mi-tienda-miyagi": {
      "url": "${MCP_URL}",
      "transport": "http",
      "headers": { "Authorization": "Bearer ${token}" }
    }
  }
}`
}

export default function ConnectAgentPanel({ initialTokenSet = false }: { initialTokenSet?: boolean }) {
  const [token, setToken] = useState<string | null>(null) // plaintext, shown once
  const [tokenSet, setTokenSet] = useState(initialTokenSet)
  const [busy, setBusy] = useState(false)
  const [tokenCopied, setTokenCopied] = useState(false)
  const [snippetCopied, setSnippetCopied] = useState(false)

  // Personal MCP URL (Sprint 2). `null` while loading/unavailable (flag off) —
  // the block below simply doesn't render until we know it exists.
  const [connectorUrl, setConnectorUrl] = useState<string | null>(null)
  const [connectorRevoked, setConnectorRevoked] = useState(false) // explicit revoke → show "generar" instead of auto-refetch
  const [connectorBusy, setConnectorBusy] = useState(false)
  const [connectorCopied, setConnectorCopied] = useState(false)
  const [connectorError, setConnectorError] = useState<string | null>(null)

  async function fetchConnector() {
    try {
      const res = await fetch('/api/sell/agent-connector')
      if (!res.ok) return // 404 (flag off) or not signed in — stays hidden, legacy flow only
      const data = (await res.json().catch(() => ({}))) as { url?: string }
      if (data.url) { setConnectorUrl(data.url); setConnectorRevoked(false) }
    } catch {
      /* network error — stays hidden, legacy flow only */
    }
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void fetchConnector() }, [])

  async function rotateConnector() {
    setConnectorBusy(true)
    setConnectorError(null)
    try {
      const res = await fetch('/api/sell/agent-connector', { method: 'POST' })
      const data = (await res.json().catch(() => ({}))) as { url?: string }
      if (res.ok && data.url) { setConnectorUrl(data.url); setConnectorRevoked(false) }
      else setConnectorError('No se pudo rotar la URL. Intenta de nuevo.')
    } catch {
      setConnectorError('Error de red al rotar la URL.')
    } finally { setConnectorBusy(false) }
  }

  async function revokeConnector() {
    setConnectorBusy(true)
    setConnectorError(null)
    try {
      const res = await fetch('/api/sell/agent-connector', { method: 'DELETE' })
      // Only clear the shown URL on a confirmed 2xx — a non-ok response means the
      // credential is still live server-side, so the UI must not claim it's revoked.
      if (res.ok) { setConnectorUrl(null); setConnectorRevoked(true) }
      else setConnectorError('No se pudo revocar la URL. Sigue activa — intenta de nuevo.')
    } catch {
      setConnectorError('Error de red al revocar la URL.')
    } finally { setConnectorBusy(false) }
  }

  async function generate() {
    setBusy(true)
    try {
      const res = await fetch('/api/sell/agent-token', { method: 'POST' })
      const data = (await res.json().catch(() => ({}))) as { token?: string }
      if (data.token) { setToken(data.token); setTokenSet(true) }
    } catch {
      /* surfaced by the unchanged button state — seller can retry */
    } finally { setBusy(false) }
  }

  async function revoke() {
    setBusy(true)
    try {
      await fetch('/api/sell/agent-token', { method: 'DELETE' })
      setToken(null); setTokenSet(false)
    } catch {
      /* no-op — retry */
    } finally { setBusy(false) }
  }

  const snippet = mcpSnippet(token ?? TOKEN_PLACEHOLDER)

  return (
    <div>
      {/* Personal MCP URL — always shown once provisioned, no button press to discover.
          Renders nothing if the flag is off (fetchConnector silently no-ops on 404). */}
      {connectorUrl ? (
        <div className="bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-xl p-4 mb-4">
          <p className="text-xs font-semibold mb-2">Tu URL personal de agente (MCP)</p>
          <p className="text-xs text-[var(--color-muted)] mb-3">
            Pégala directo en Claude — sin token, sin config. Trátala como una contraseña: cualquiera con
            este enlace puede leer y ajustar tu tienda.
          </p>
          <div className="flex items-center gap-2 bg-white border border-[var(--color-border)] rounded-lg px-3 py-2 mb-3">
            <code className="flex-1 text-xs font-mono text-[var(--color-foreground)] break-all">{connectorUrl}</code>
            <button
              type="button"
              onClick={() => { navigator.clipboard.writeText(connectorUrl); setConnectorCopied(true); setTimeout(() => setConnectorCopied(false), 2000) }}
              className="text-xs text-[var(--color-accent)] hover:underline flex-shrink-0 px-1.5"
            >
              {connectorCopied ? '✓ Copiado' : 'Copiar'}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={ADD_TO_CLAUDE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-[var(--color-accent)] text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-[var(--color-accent-hover)] transition-colors"
            >
              Agregar a Claude
            </a>
            <button
              type="button"
              onClick={rotateConnector}
              disabled={connectorBusy}
              className="text-xs text-[var(--color-muted)] border border-[var(--color-border)] rounded px-2.5 py-1.5 hover:bg-gray-100 disabled:opacity-50"
            >
              Rotar
            </button>
            <button
              type="button"
              onClick={revokeConnector}
              disabled={connectorBusy}
              className="text-xs text-red-600 border border-red-200 rounded px-2.5 py-1.5 hover:bg-red-50 disabled:opacity-50"
            >
              Revocar
            </button>
          </div>
          {connectorError && <p className="text-[11px] text-red-600 mt-2">⚠ {connectorError}</p>}
          <p className="text-[11px] text-[var(--color-muted)] mt-2">
            Rotar invalida el enlace anterior de inmediato. Pagos, dominio y Cal.com siempre se quedan en un
            paso manual.
          </p>
        </div>
      ) : connectorRevoked ? (
        <div className="bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-xl p-4 mb-4">
          <p className="text-xs text-[var(--color-muted)] mb-2">Revocaste tu URL de agente.</p>
          <button
            type="button"
            onClick={fetchConnector}
            disabled={connectorBusy}
            className="text-xs bg-[var(--color-accent)] text-white px-3 py-1.5 rounded-lg font-semibold hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
          >
            Generar nueva URL
          </button>
        </div>
      ) : null}

      <p className="text-xs text-[var(--color-muted)] mb-3">
        Para Claude Desktop u otros clientes MCP: genera un token con encabezado <code className="font-mono">Authorization</code>.
        Solo afecta a esta tienda. Pagos, dominio y Cal.com siempre se quedan en un paso manual.
      </p>

      {/* Token generation (show-once) — para Claude Desktop u otros clientes */}
      {token ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-3">
          <p className="text-xs font-semibold text-amber-800 mb-2">⚠️ Copia este token ahora — no se vuelve a mostrar.</p>
          <div className="flex items-center gap-2 bg-white border border-amber-200 rounded-lg px-3 py-2">
            <code className="flex-1 text-xs font-mono text-[var(--color-foreground)] break-all">{token}</code>
            <button
              type="button"
              onClick={() => { navigator.clipboard.writeText(token); setTokenCopied(true); setTimeout(() => setTokenCopied(false), 2000) }}
              className="text-xs text-[var(--color-accent)] hover:underline flex-shrink-0 px-1.5"
            >
              {tokenCopied ? '✓ Copiado' : 'Copiar'}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <button
            type="button"
            onClick={generate}
            disabled={busy}
            className="bg-[var(--color-accent)] text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-50"
          >
            {busy ? 'Generando…' : tokenSet ? 'Regenerar token' : 'Generar token de agente'}
          </button>
          {tokenSet && (
            <>
              <span className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-full px-2.5 py-1">✓ Token activo</span>
              <button
                type="button"
                onClick={revoke}
                disabled={busy}
                className="text-xs text-red-600 border border-red-200 rounded px-2.5 py-1 hover:bg-red-50 disabled:opacity-50"
              >
                Revocar
              </button>
            </>
          )}
        </div>
      )}

      {/* Ready-to-paste MCP client config */}
      <p className="text-xs text-[var(--color-muted)] mb-2">
        Pega esta configuración en tu cliente MCP (Claude Desktop u otro), con tu token en lugar del marcador:
      </p>
      <div className="relative">
        <pre className="text-[11px] bg-gray-900 text-green-400 rounded-lg p-3 overflow-x-auto leading-relaxed">{snippet}</pre>
        <button
          type="button"
          onClick={() => { navigator.clipboard.writeText(snippet); setSnippetCopied(true); setTimeout(() => setSnippetCopied(false), 2000) }}
          className="absolute top-2 right-2 text-[10px] bg-gray-700 text-gray-300 hover:bg-gray-600 px-2 py-0.5 rounded"
        >
          {snippetCopied ? '✓ Copiado' : 'Copiar'}
        </button>
      </div>
    </div>
  )
}
