'use client'

import { useState } from 'react'

/**
 * "Conecta tu agente" — the reusable per-shop MCP token + config helper.
 *
 * Generates a per-shop agent token (POST /api/sell/agent-token, DELETE to revoke)
 * and renders the ready-to-paste MCP-client config snippet. Self-contained so it can
 * be dropped onto the first-run success screen as well as the seller settings page —
 * it mirrors the proven token-generation + copy-button pattern without depending on
 * the settings page's local helpers.
 */

const MCP_URL = 'https://miyagisanchez.com/api/ucp/mcp'
const TOKEN_PLACEHOLDER = 'PEGA_TU_TOKEN_AQUÍ'

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
      <p className="text-xs text-[var(--color-muted)] mb-3">
        Genera un token para que tu propio agente de IA lea y ajuste tu tienda vía MCP. Solo afecta a esta
        tienda. Pagos, dominio y Cal.com siempre se quedan en un paso manual.
      </p>

      {/* Token generation (show-once) */}
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
