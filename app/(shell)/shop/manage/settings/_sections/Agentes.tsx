'use client'

/**
 * Agentes e integraciones (slug `agentes`) — extracted out of the ShopSettings
 * monolith. The single internal `webhook` section: UCP webhook URL + signing
 * secret, the MCP agent-token issue/revoke, and a ready-to-paste MCP config.
 *
 * Behavior-preserving: the agent-token flow fires the same requests —
 * `POST /api/sell/agent-token` (issue) and `DELETE /api/sell/agent-token`
 * (revoke). The "Guardar cambios" footer persists the top-level
 * ucp_webhook_url + ucp_webhook_secret through useSettingsSave() → PATCH
 * /api/sell/shop (exactly as the monolith did, incl. auto-generating a secret
 * when a URL is set without one).
 *
 * Secret-strip invariant: this component receives only `agent_token_set` (a
 * boolean derived server-side) — the hashed token `ucp_agent_token_hash` never
 * reaches the client. The plaintext agent token exists only transiently in
 * client state right after issuance (shown once), never persisted here.
 */

import { useState } from 'react'
import { useSettingsSave } from '../_components/useSettingsSave'
import { Toast } from '../_components/Toast'
import { SectionTitle } from '../_components/SectionTitle'
import { CopyPromptButton } from '../_components/CopyPromptButton'
import { generateHex32 } from '@/lib/shop-settings/helpers'

export interface AgentesInitial {
  ucp_webhook_url?: string | null
  ucp_webhook_secret?: string | null
  /** Whether an MCP agent token is already provisioned (the hash never reaches the client). */
  agent_token_set?: boolean
}

export default function Agentes({ initial }: { initial: AgentesInitial }) {
  const { save, saving, toast, dismissToast, isDirty, markDirty, showToast } = useSettingsSave()
  const mark = markDirty

  // UCP Webhook
  const [webhookUrl, setWebhookUrl]         = useState(initial.ucp_webhook_url ?? '')
  const [webhookSecret, setWebhookSecret]   = useState(initial.ucp_webhook_secret ?? '')
  const [showWebhookSecret, setShowWebhookSecret] = useState(false)
  const [webhookAdvanced, setWebhookAdvanced]     = useState(false)
  const [showPayloadPreview, setShowPayloadPreview] = useState(false)
  const [webhookCopied, setWebhookCopied]   = useState(false)
  const [webhookUrlError, setWebhookUrlError] = useState('')
  const [webhookSaveError, setWebhookSaveError] = useState('')

  // MCP agent token — the inbound credential a seller's agent uses to read/patch
  // this shop's config. We only ever see the plaintext at creation.
  const [agentTokenSet, setAgentTokenSet]   = useState(initial.agent_token_set ?? false)
  const [agentToken, setAgentToken]         = useState<string | null>(null) // plaintext, shown once
  const [agentTokenBusy, setAgentTokenBusy] = useState(false)
  const [agentTokenCopied, setAgentTokenCopied] = useState(false)
  const [mcpConfigCopied, setMcpConfigCopied] = useState(false)

  async function handleGenerateAgentToken() {
    setAgentTokenBusy(true)
    try {
      const res = await fetch('/api/sell/agent-token', { method: 'POST' })
      const data = await res.json() as { token?: string; error?: string }
      if (!res.ok || !data.token) { showToast(data.error ?? 'No se pudo generar el token.', 'error'); return }
      setAgentToken(data.token)
      setAgentTokenSet(true)
      showToast('Token de agente generado. Cópialo ahora — no se vuelve a mostrar.', 'success')
    } catch { showToast('Error de red al generar el token.', 'error') }
    finally { setAgentTokenBusy(false) }
  }

  async function handleRevokeAgentToken() {
    setAgentTokenBusy(true)
    try {
      const res = await fetch('/api/sell/agent-token', { method: 'DELETE' })
      if (!res.ok) { const d = await res.json().catch(() => ({})) as { error?: string }; showToast(d.error ?? 'No se pudo revocar.', 'error'); return }
      setAgentToken(null)
      setAgentTokenSet(false)
      showToast('Token de agente revocado.', 'success')
    } catch { showToast('Error de red al revocar.', 'error') }
    finally { setAgentTokenBusy(false) }
  }

  async function handleSave() {
    if (webhookUrl.trim() && !webhookUrl.trim().startsWith('https://')) {
      setWebhookSaveError('La URL del webhook debe usar HTTPS.')
      document.getElementById('webhook')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
    setWebhookSaveError('')
    let secretToSave = webhookSecret.trim()
    if (webhookUrl.trim() && !secretToSave) {
      secretToSave = generateHex32()
      setWebhookSecret(secretToSave)
    }
    await save({
      ucp_webhook_url:   webhookUrl.trim() || null,
      ucp_webhook_secret: secretToSave || null,
    }, {
      onFieldError: (field, message) => {
        if (field === 'webhook') {
          setWebhookSaveError(message)
          document.getElementById('webhook')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      },
    })
  }

  return (
    <div>
      <section id="webhook" className="border border-[var(--color-border)] rounded-xl p-5 mb-5">
        <div className="flex items-center justify-between mb-1">
          <SectionTitle>Conectar tu sistema</SectionTitle>
          <div className="-mt-3">
            <CopyPromptButton prompt="¿Qué es un webhook y para qué sirve en un sistema de e-commerce? Explícame en términos sencillos qué es HMAC-SHA256 y cómo sirve para verificar que las notificaciones son auténticas. ¿Qué herramientas sin código como Zapier o Make.com puedo usar para recibir estos datos sin saber programar? Referencia: https://en.wikipedia.org/wiki/HMAC y https://zapier.com/blog/what-are-webhooks/" />
          </div>
        </div>
        <p className="text-xs text-[var(--color-muted)] mb-4">
          Recibe una notificación automática cada vez que se complete una venta — directo a tu herramienta o sistema.
        </p>

        {/* Explainer cuando no hay URL */}
        {!webhookUrl && (
          <div className="mb-4 bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-xl p-4">
            <p className="text-xs font-semibold mb-2">¿Para qué sirve esto?</p>
            <p className="text-xs text-[var(--color-muted)] mb-3 leading-relaxed">
              Cuando alguien compra en tu tienda, enviamos los datos del pedido (comprador, artículo, monto, dirección) a la URL que configures. Es como una llamada automática de &ldquo;llegó un pedido&rdquo; a tu sistema.
            </p>
            <div className="flex flex-wrap gap-2">
              {['Zapier', 'Make.com', 'n8n', 'CRM propio', 'ERP', 'Sistema de inventarios'].map(tool => (
                <span key={tool} className="text-xs bg-white border border-[var(--color-border)] text-[var(--color-muted)] px-2.5 py-1 rounded-full">
                  {tool}
                </span>
              ))}
            </div>
            <p className="text-xs text-[var(--color-muted)] mt-3">
              Si no tienes un sistema técnico, <strong>no necesitas esto</strong>. Puedes gestionar pedidos directamente desde tu panel.
            </p>
          </div>
        )}

        {/* URL input */}
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">URL de notificación</label>
            <input
              value={webhookUrl}
              onChange={e => {
                const v = e.target.value
                setWebhookUrl(v)
                mark()
                if (v && !v.startsWith('https://')) {
                  setWebhookUrlError('La URL debe comenzar con https://')
                } else {
                  setWebhookUrlError('')
                }
              }}
              type="url"
              placeholder="https://tu-sistema.com/pedidos"
              className={`w-full border rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] ${
                webhookUrlError || webhookSaveError ? 'border-red-400' : 'border-[var(--color-border)]'
              }`}
            />
            {(webhookUrlError || webhookSaveError) && (
              <p className="text-red-600 text-xs mt-1">⚠ {webhookUrlError || webhookSaveError}</p>
            )}
          </div>

          {/* Secret display */}
          {webhookUrl && !webhookUrlError && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium">Clave de seguridad</label>
                {!webhookSecret && (
                  <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                    Se genera al guardar
                  </span>
                )}
              </div>

              {webhookSecret ? (
                <div className="flex items-center gap-2 bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-lg px-3 py-2">
                  <code className="flex-1 text-xs font-mono text-[var(--color-muted)] truncate">
                    {showWebhookSecret ? webhookSecret : '•'.repeat(Math.min(webhookSecret.length, 32))}
                  </code>
                  <button type="button"
                    onClick={() => setShowWebhookSecret(v => !v)}
                    className="text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)] flex-shrink-0 px-1.5">
                    {showWebhookSecret ? 'Ocultar' : 'Ver'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(webhookSecret)
                      setWebhookCopied(true)
                      setTimeout(() => setWebhookCopied(false), 2000)
                    }}
                    className="text-xs text-[var(--color-accent)] hover:underline flex-shrink-0 px-1.5"
                  >
                    {webhookCopied ? '✓ Copiado' : 'Copiar'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setWebhookSecret(generateHex32()); mark() }}
                    className="text-xs text-[var(--color-muted)] border border-[var(--color-border)] rounded px-2 py-0.5 hover:bg-gray-100 flex-shrink-0"
                  >
                    Regenerar
                  </button>
                </div>
              ) : (
                <p className="text-xs text-[var(--color-muted)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-lg px-3 py-2">
                  🔐 Cuando guardes los cambios, se generará una clave secreta automáticamente. Úsala para verificar que las notificaciones vienen de Miyagi Sánchez.
                </p>
              )}
            </div>
          )}

          {/* Modo avanzado */}
          {webhookUrl && !webhookUrlError && (
            <div>
              <button
                type="button"
                onClick={() => setWebhookAdvanced(v => !v)}
                className="text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)] flex items-center gap-1"
              >
                <span>{webhookAdvanced ? '▾' : '▸'}</span>
                Modo avanzado — HMAC-SHA256
              </button>

              {webhookAdvanced && (
                <div className="mt-3 space-y-3 pl-3 border-l-2 border-[var(--color-border)]">
                  <p className="text-xs text-[var(--color-muted)]">
                    Verifica la firma en el header <code className="font-mono bg-gray-100 px-1 rounded">X-UCP-Signature</code> usando HMAC-SHA256 con tu clave secreta y el cuerpo del request.
                  </p>
                  <div>
                    <label className="block text-xs font-medium mb-1">Clave personalizada (opcional)</label>
                    <div className="flex gap-2">
                      <input
                        value={webhookSecret}
                        onChange={e => { setWebhookSecret(e.target.value); mark() }}
                        type={showWebhookSecret ? 'text' : 'password'}
                        placeholder="Ingresa tu propia clave o usa la generada"
                        className="flex-1 border border-[var(--color-border)] rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                      />
                      <button type="button" onClick={() => setShowWebhookSecret(v => !v)}
                        className="px-3 py-2 border border-[var(--color-border)] rounded text-xs hover:bg-gray-50">
                        {showWebhookSecret ? 'Ocultar' : 'Ver'}
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowPayloadPreview(v => !v)}
                    className="text-xs text-[var(--color-accent)] hover:underline"
                  >
                    {showPayloadPreview ? '▾' : '▸'} ¿Qué datos recibes? — Ver ejemplo de payload
                  </button>
                  {showPayloadPreview && (
                    <div className="relative">
                      <pre className="text-[10px] bg-gray-900 text-green-400 rounded-lg p-3 overflow-x-auto leading-relaxed">{`{
  "event": "order.completed",
  "order_id": "ord_abc123",
  "created_at": "2025-05-23T12:00:00Z",
  "listing": {
    "id": "lst_xyz",
    "title": "iPhone 14 Pro Max",
    "price_mxn": 18500
  },
  "buyer": {
    "email": "comprador@ejemplo.com",
    "trust_level": "verified",
    "trust_score": 82
  },
  "payment": {
    "method": "stripe",
    "status": "paid"
  }
}`}</pre>
                      <button
                        type="button"
                        onClick={() => navigator.clipboard.writeText('{"event":"order.completed","order_id":"ord_abc123"}')}
                        className="absolute top-2 right-2 text-[10px] bg-gray-700 text-gray-300 hover:bg-gray-600 px-2 py-0.5 rounded"
                      >
                        Copiar
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── MCP agent token — let an AI agent read/patch this shop's config ── */}
        <div className="mt-6 pt-5 border-t border-[var(--color-border)]">
          <div className="flex items-center justify-between mb-1">
            <SectionTitle>Token para tu agente (MCP)</SectionTitle>
            <CopyPromptButton prompt="¿Qué es el Model Context Protocol (MCP) y cómo puede un agente de IA configurar mi tienda por mí? Explícame en términos sencillos cómo funciona un token tipo 'Bearer' y por qué solo debo compartirlo con mi propio asistente de confianza." />
          </div>
          <p className="text-xs text-[var(--color-muted)] mb-4">
            Genera un token para que tu propio agente de IA lea y ajuste la configuración de tu tienda
            vía MCP (<code className="font-mono bg-gray-100 px-1 rounded">get_store_configuration</code> /
            <code className="font-mono bg-gray-100 px-1 rounded">patch_store_configuration</code>) sin entrar al panel.
            Solo afecta a esta tienda. No incluye pagos, dominio ni claves — eso siempre se queda en un paso manual.
          </p>

          {agentToken ? (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <p className="text-xs font-semibold text-amber-800 mb-2">
                ⚠️ Copia este token ahora — no se vuelve a mostrar.
              </p>
              <div className="flex items-center gap-2 bg-white border border-amber-200 rounded-lg px-3 py-2">
                <code className="flex-1 text-xs font-mono text-[var(--color-foreground)] break-all">{agentToken}</code>
                <button
                  type="button"
                  onClick={() => { navigator.clipboard.writeText(agentToken); setAgentTokenCopied(true); setTimeout(() => setAgentTokenCopied(false), 2000) }}
                  className="text-xs text-[var(--color-accent)] hover:underline flex-shrink-0 px-1.5"
                >
                  {agentTokenCopied ? '✓ Copiado' : 'Copiar'}
                </button>
              </div>
              <p className="text-[11px] text-amber-700 mt-2">
                Úsalo como <code className="font-mono">Authorization: Bearer {'{token}'}</code> contra el servidor MCP en <code className="font-mono">/api/ucp/mcp</code>.
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleGenerateAgentToken}
                disabled={agentTokenBusy}
                className="bg-[var(--color-accent)] text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-50"
              >
                {agentTokenBusy ? 'Generando…' : agentTokenSet ? 'Regenerar token' : 'Generar token de agente'}
              </button>
              {agentTokenSet && (
                <>
                  <span className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-full px-2.5 py-1">✓ Token activo</span>
                  <button
                    type="button"
                    onClick={handleRevokeAgentToken}
                    disabled={agentTokenBusy}
                    className="text-xs text-red-600 border border-red-200 rounded px-2.5 py-1 hover:bg-red-50 disabled:opacity-50"
                  >
                    Revocar
                  </button>
                </>
              )}
            </div>
          )}
          {agentTokenSet && !agentToken && (
            <p className="text-[11px] text-[var(--color-muted)] mt-2">
              Regenerar invalida el token anterior. Si crees que se filtró, revócalo de inmediato.
            </p>
          )}
        </div>

        {/* ── Conecta tu agente — ready-to-paste MCP config ── */}
        <div className="mt-6 pt-5 border-t border-[var(--color-border)]">
          <SectionTitle>Conecta tu agente</SectionTitle>
          <p className="text-xs text-[var(--color-muted)] mb-3">
            Pega esta configuración en tu cliente MCP (Claude Desktop u otro) para que tu agente lea y
            ajuste tu tienda. Reemplaza el token por el que generaste arriba.
          </p>
          {(() => {
            const token = agentToken ?? 'PEGA_TU_TOKEN_AQUÍ'
            const snippet = `{
  "mcpServers": {
    "mi-tienda-miyagi": {
      "url": "https://miyagisanchez.com/api/ucp/mcp",
      "transport": "http",
      "headers": { "Authorization": "Bearer ${token}" }
    }
  }
}`
            return (
              <div className="relative">
                <pre className="text-[11px] bg-gray-900 text-green-400 rounded-lg p-3 overflow-x-auto leading-relaxed">{snippet}</pre>
                <button
                  type="button"
                  onClick={() => { navigator.clipboard.writeText(snippet); setMcpConfigCopied(true); setTimeout(() => setMcpConfigCopied(false), 2000) }}
                  className="absolute top-2 right-2 text-[10px] bg-gray-700 text-gray-300 hover:bg-gray-600 px-2 py-0.5 rounded"
                >
                  {mcpConfigCopied ? '✓ Copiado' : 'Copiar'}
                </button>
              </div>
            )
          })()}
          <ol className="mt-3 text-xs text-[var(--color-muted)] list-decimal list-inside space-y-1">
            <li>Genera tu token arriba y cópialo.</li>
            <li>Pega esta configuración en tu cliente MCP, con tu token en lugar del marcador.</li>
            <li>Tu agente podrá usar <code className="font-mono">get_store_configuration</code> y <code className="font-mono">patch_store_configuration</code>.</li>
          </ol>
          <p className="text-[11px] text-[var(--color-muted)] mt-2">
            Tu agente puede ajustar perfil, envíos, negociación, notificaciones, pedidos y devoluciones.
            Pagos, dominio y Cal.com siempre requieren un paso manual.
          </p>
        </div>
      </section>

      {/* ── Save button ───────────────────────────────────────────────────── */}
      {/* Back affordance now lives in the top-of-page breadcrumb (<SellerBreadcrumb>). */}
      <div className="flex items-center justify-end mb-24">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="bg-[var(--color-accent)] text-white px-6 py-2.5 rounded-lg font-semibold text-sm hover:bg-[var(--color-accent-hover)] disabled:opacity-50 transition-colors"
        >
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>

      {/* ── Sticky unsaved bar ────────────────────────────────────────────────── */}
      {isDirty && (
        <div className="fixed bottom-0 inset-x-0 z-40 bg-white border-t border-[var(--color-border)] shadow-lg">
          <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
              <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
              Tienes cambios sin guardar
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="text-sm text-[var(--color-muted)] hover:text-[var(--color-foreground)] px-3 py-1.5 border border-[var(--color-border)] rounded-lg transition-colors"
              >
                Descartar
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="bg-[var(--color-accent)] text-white px-5 py-1.5 rounded-lg font-semibold text-sm hover:bg-[var(--color-accent-hover)] disabled:opacity-50 transition-colors"
              >
                {saving ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast toast={toast} onDismiss={dismissToast} />}
    </div>
  )
}
