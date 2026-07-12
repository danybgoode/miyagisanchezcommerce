'use client'

/**
 * Agentes e integraciones (slug `agentes`) — extracted out of the ShopSettings
 * monolith. The `webhook` section (UCP webhook URL + signing secret) plus the
 * shared `<ConnectAgentPanel>` for the MCP agent-token / personal-URL flow —
 * the same component the `/sell/setup` success screen uses, so the URL/token
 * UI is built once, not duplicated per surface (seller-agent-connect-mcp-url
 * Sprint 2).
 *
 * Behavior-preserving: `useSettingsSave()`'s "Guardar cambios" footer still
 * persists only the top-level ucp_webhook_url + ucp_webhook_secret through
 * PATCH /api/sell/shop (exactly as the monolith did, incl. auto-generating a
 * secret when a URL is set without one) — the agent-token/connector flow lives
 * entirely inside `<ConnectAgentPanel>` and saves independently via its own
 * fetch calls, same as it always has on `/sell/setup`.
 *
 * Secret-strip invariant: this component receives only `agent_token_set` (a
 * boolean derived server-side) — the hashed token `ucp_agent_token_hash` never
 * reaches the client. `<ConnectAgentPanel>` only ever sees the plaintext agent
 * token transiently, right after issuance (shown once).
 */

import { useState } from 'react'
import { useSettingsSave } from '../_components/useSettingsSave'
import { Toast } from '@/components/feedback/Toast'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Button } from '@/components/ui/Button'
import { SectionTitle } from '../_components/SectionTitle'
import { CopyPromptButton } from '../_components/CopyPromptButton'
import { generateHex32 } from '@/lib/shop-settings/helpers'
import ConnectAgentPanel from '@/components/ConnectAgentPanel'

export interface AgentesInitial {
  ucp_webhook_url?: string | null
  ucp_webhook_secret?: string | null
  /** Whether an MCP agent token is already provisioned (the hash never reaches the client). */
  agent_token_set?: boolean
}

export default function Agentes({ initial }: { initial: AgentesInitial }) {
  const { save, saving, toast, dismissToast, isDirty, markDirty } = useSettingsSave()
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
      <section id="webhook" className="border border-[var(--color-border)] rounded-[var(--r-lg)] p-5 mb-5">
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
          <div className="mb-4 bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-[var(--r-lg)] p-4">
            <p className="text-xs font-semibold mb-2">¿Para qué sirve esto?</p>
            <p className="text-xs text-[var(--color-muted)] mb-3 leading-relaxed">
              Cuando alguien compra en tu tienda, enviamos los datos del pedido (comprador, artículo, monto, dirección) a la URL que configures. Es como una llamada automática de &ldquo;llegó un pedido&rdquo; a tu sistema.
            </p>
            <div className="flex flex-wrap gap-2">
              {['Zapier', 'Make.com', 'n8n', 'CRM propio', 'ERP', 'Sistema de inventarios'].map(tool => (
                <span key={tool} className="text-xs bg-[var(--bg-elevated)] border border-[var(--color-border)] text-[var(--color-muted)] px-2.5 py-1 rounded-[var(--r-pill)]">
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
              className={`w-full border rounded-[var(--r-sm)] px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] ${
                webhookUrlError || webhookSaveError ? 'border-[var(--danger)]' : 'border-[var(--color-border)]'
              }`}
            />
            {(webhookUrlError || webhookSaveError) && (
              <p className="text-[var(--danger)] text-xs mt-1"><i className="iconoir-warning-triangle" aria-hidden /> {webhookUrlError || webhookSaveError}</p>
            )}
          </div>

          {/* Secret display */}
          {webhookUrl && !webhookUrlError && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium">Clave de seguridad</label>
                {!webhookSecret && (
                  <StatusBadge token="warning">
                    Se genera al guardar
                  </StatusBadge>
                )}
              </div>

              {webhookSecret ? (
                <div className="flex items-center gap-2 bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-[var(--r-sm)] px-3 py-2">
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
                    {webhookCopied ? <><i className="iconoir-check" aria-hidden /> Copiado</> : 'Copiar'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setWebhookSecret(generateHex32()); mark() }}
                    className="text-xs text-[var(--color-muted)] border border-[var(--color-border)] rounded-[var(--r-sm)] px-2 py-0.5 hover:bg-gray-100 flex-shrink-0"
                  >
                    Regenerar
                  </button>
                </div>
              ) : (
                <p className="text-xs text-[var(--color-muted)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-[var(--r-sm)] px-3 py-2">
                  <i className="iconoir-lock" aria-hidden /> Cuando guardes los cambios, se generará una clave secreta automáticamente. Úsala para verificar que las notificaciones vienen de Miyagi Sánchez.
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
                    Verifica la firma en el header <code className="font-mono bg-gray-100 px-1 rounded-[var(--r-xs)]">X-UCP-Signature</code> usando HMAC-SHA256 con tu clave secreta y el cuerpo del request.
                  </p>
                  <div>
                    <label className="block text-xs font-medium mb-1">Clave personalizada (opcional)</label>
                    <div className="flex gap-2">
                      <input
                        value={webhookSecret}
                        onChange={e => { setWebhookSecret(e.target.value); mark() }}
                        type={showWebhookSecret ? 'text' : 'password'}
                        placeholder="Ingresa tu propia clave o usa la generada"
                        className="flex-1 border border-[var(--color-border)] rounded-[var(--r-sm)] px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                      />
                      <button type="button" onClick={() => setShowWebhookSecret(v => !v)}
                        className="px-3 py-2 border border-[var(--color-border)] rounded-[var(--r-sm)] text-xs hover:bg-gray-50">
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
                      <pre className="text-[10px] bg-gray-900 text-green-400 rounded-[var(--r-sm)] p-3 overflow-x-auto leading-relaxed">{`{
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
                        className="absolute top-2 right-2 text-[10px] bg-gray-700 text-gray-300 hover:bg-gray-600 px-2 py-0.5 rounded-[var(--r-xs)]"
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

        {/* ── Conecta tu agente — personal MCP URL + Bearer token, shared panel ── */}
        <div className="mt-6 pt-5 border-t border-[var(--color-border)]">
          <div className="flex items-center justify-between mb-1">
            <SectionTitle>Conecta tu agente</SectionTitle>
            <CopyPromptButton prompt="¿Qué es el Model Context Protocol (MCP) y cómo puede un agente de IA configurar mi tienda por mí? Explícame en términos sencillos cómo funciona un token tipo 'Bearer' y por qué solo debo compartirlo con mi propio asistente de confianza." />
          </div>
          <ConnectAgentPanel initialTokenSet={initial.agent_token_set ?? false} />
        </div>
      </section>

      {/* ── Save button ───────────────────────────────────────────────────── */}
      {/* Back affordance now lives in the top-of-page breadcrumb (<SellerBreadcrumb>). */}
      <div className="flex items-center justify-end mb-24">
        <Button
          type="button"
          variant="primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </Button>
      </div>

      {/* ── Sticky unsaved bar ────────────────────────────────────────────────── */}
      {isDirty && (
        <div className="fixed bottom-0 inset-x-0 z-40 bg-[var(--bg-elevated)] border-t border-[var(--color-border)] shadow-lg">
          <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
              <span className="w-2 h-2 rounded-[var(--r-pill)] bg-[var(--warning)] flex-shrink-0" />
              Tienes cambios sin guardar
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => window.location.reload()}
              >
                Descartar
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? 'Guardando…' : 'Guardar'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast toast={toast} onDismiss={dismissToast} />}
    </div>
  )
}
