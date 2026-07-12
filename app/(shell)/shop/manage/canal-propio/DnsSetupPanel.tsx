'use client'

/**
 * DnsSetupPanel — the "how to point your DNS at us" block: Cloudflare
 * auto-config, per-registrar step-by-step (when a known registrar is
 * detected), and a generic fallback. Extracted from `CanalPropioClient.tsx`
 * (which had crept back up near the anti-monolith line cap, the exact
 * pattern LEARNINGS documents for the DNS-record-card cluster) to keep the
 * federation page's main file under the cap — same rationale as the
 * `SubdomainSection`/`DomainPaywallUpsell` extractions that predate this
 * split. Behavior-preserving: no logic change, purely moved JSX + its
 * controlled props. Renders nothing once DNS is already verified
 * (`domainDnsOk`).
 */

import { Banner } from '@/components/feedback/Banner'
import { Button } from '@/components/ui/Button'
import { CNAME_TARGET, dnsRecordFor } from '@/lib/domain-utils'

type DnsRecord = ReturnType<typeof dnsRecordFor>

export interface RegistrarGuide {
  name: string
  icon: string
  url: string
  steps: string[]
}

export default function DnsSetupPanel({
  domainDnsOk,
  detectedRegistrar,
  registrarGuides,
  savedDomain,
  dnsRecord,
  showCfPanel,
  onToggleCfPanel,
  cfTokenInput,
  onCfTokenInputChange,
  cfSaving,
  cfError,
  cfSuccess,
  onCfAutoConfig,
}: {
  domainDnsOk: boolean
  detectedRegistrar: string | null
  registrarGuides: Record<string, RegistrarGuide>
  savedDomain: string
  dnsRecord: DnsRecord | null
  showCfPanel: boolean
  onToggleCfPanel: () => void
  cfTokenInput: string
  onCfTokenInputChange: (value: string) => void
  cfSaving: boolean
  cfError: string | null
  cfSuccess: boolean
  onCfAutoConfig: () => void
}) {
  if (domainDnsOk) return null

  return (
    <div className="space-y-3 mb-3">

      {/* Cloudflare auto-config */}
      <div className={`border rounded-[var(--r-md)] overflow-hidden ${detectedRegistrar === 'cloudflare' ? 'border-orange-300 bg-orange-50/30' : 'border-[var(--color-border)]'}`}>
        <button
          type="button"
          onClick={onToggleCfPanel}
          className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[var(--color-surface-alt)] transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <i className="iconoir-cloud text-lg" aria-hidden />
            <div>
              <p className="text-xs font-semibold">
                {detectedRegistrar === 'cloudflare'
                  ? '¡Tu dominio está en Cloudflare! Configura en segundos'
                  : 'Configurar automáticamente con Cloudflare'}
              </p>
              <p className="text-xs text-[var(--color-muted)]">
                {detectedRegistrar === 'cloudflare'
                  ? 'Crea un token de API y nosotros hacemos el resto'
                  : 'Si tu dominio usa Cloudflare, lo configuramos por ti'}
              </p>
            </div>
          </div>
          <span className="text-xs text-[var(--color-muted)] flex-shrink-0 ml-3">{showCfPanel ? '▲' : '▼'}</span>
        </button>

        {showCfPanel && (
          <div className="px-4 pb-4 pt-3 border-t border-[var(--color-border)] space-y-4 bg-[var(--color-surface-alt)]">

            {/* Step 1 — Get the token */}
            <div>
              <p className="text-xs font-semibold text-[var(--color-foreground)] mb-2">
                Paso 1 — Crea el token en Cloudflare
              </p>
              <a
                href="https://dash.cloudflare.com/profile/api-tokens/create"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-[var(--provider-envia)] text-[var(--fg-inverse)] text-xs font-semibold px-3 py-2 rounded-[var(--r-md)] hover:bg-[var(--provider-envia-hover)] transition-colors no-underline mb-3"
              >
                <i className="iconoir-cloud" aria-hidden /> Abrir Cloudflare → Crear token
              </a>
              <ol className="space-y-1.5">
                {[
                  <>En la página de Cloudflare, clic en <strong>&ldquo;Use template&rdquo;</strong> junto a <strong>&ldquo;Edit zone DNS&rdquo;</strong></>,
                  <>En &ldquo;Zone Resources&rdquo; → selecciona <strong>Specific zone</strong> → elige <strong>{savedDomain || 'tu dominio'}</strong></>,
                  <>Clic en <strong>&ldquo;Continue to summary&rdquo;</strong> → <strong>&ldquo;Create Token&rdquo;</strong></>,
                  <>Copia el token generado (solo se muestra una vez) y pégalo abajo</>,
                ].map((step, i) => (
                  <li key={i} className="flex gap-2 text-xs text-[var(--color-muted)]">
                    <span className="flex-shrink-0 w-4 h-4 rounded-[var(--r-pill)] bg-[var(--bg-elevated)] border border-[var(--color-border)] flex items-center justify-center text-[10px] font-bold mt-0.5">{i + 1}</span>
                    <span className="leading-relaxed">{step}</span>
                  </li>
                ))}
              </ol>
            </div>

            {/* Step 2 — Paste and apply */}
            <div>
              <p className="text-xs font-semibold text-[var(--color-foreground)] mb-2">
                Paso 2 — Pega el token y aplica
              </p>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={cfTokenInput}
                  onChange={e => onCfTokenInputChange(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && cfTokenInput.trim() && !cfSaving && onCfAutoConfig()}
                  placeholder="Pega tu API Token aquí"
                  autoComplete="off"
                  className="flex-1 border border-[var(--color-border)] rounded-[var(--r-sm)] px-3 py-2 text-sm bg-[var(--bg-elevated)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                />
                <Button
                  type="button"
                  variant="primary"
                  onClick={onCfAutoConfig}
                  disabled={cfSaving || !cfTokenInput.trim()}
                  className="whitespace-nowrap"
                >
                  {cfSaving
                    ? <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-[var(--r-pill)] border-2 border-white border-t-transparent animate-spin" />Configurando…</span>
                    : 'Configurar DNS'}
                </Button>
              </div>
            </div>

            {cfError && (
              <Banner variant="danger">{cfError}</Banner>
            )}
            {cfSuccess && (
              <Banner variant="success">
                Registro CNAME creado en Cloudflare. Verificando propagación automáticamente…
              </Banner>
            )}

            <p className="text-[10px] text-[var(--color-muted)]">
              <i className="iconoir-lock" aria-hidden /> El token se usa una sola vez para crear el registro y no se almacena en nuestros servidores.
            </p>
          </div>
        )}
      </div>

      {/* Per-registrar step-by-step (non-CF known registrars) */}
      {detectedRegistrar && detectedRegistrar !== 'cloudflare' && detectedRegistrar !== 'unknown' && registrarGuides[detectedRegistrar] && (
        <div className="border border-[var(--color-border)] rounded-[var(--r-md)] overflow-hidden">
          <div className="flex items-center gap-2.5 px-4 py-3 bg-[var(--color-surface-alt)] border-b border-[var(--color-border)]">
            <i className={`text-base ${registrarGuides[detectedRegistrar].icon}`} aria-hidden />
            <div>
              <p className="text-xs font-semibold">
                Instrucciones para {registrarGuides[detectedRegistrar].name}
              </p>
              <p className="text-xs text-[var(--color-muted)]">
                Detectamos que tu dominio está en {registrarGuides[detectedRegistrar].name}
              </p>
            </div>
          </div>
          <ol className="px-4 py-3 space-y-2">
            {registrarGuides[detectedRegistrar].steps.map((step, i) => (
              <li key={i} className="flex gap-2.5 text-xs text-[var(--color-muted)]">
                <span className="flex-shrink-0 w-4 h-4 rounded-[var(--r-pill)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] flex items-center justify-center text-[10px] font-bold mt-0.5">
                  {i + 1}
                </span>
                <span className="leading-relaxed">{step}</span>
              </li>
            ))}
          </ol>
          {dnsRecord && !dnsRecord.isApex && (
            <p className="px-4 pb-2 text-[10px] text-[var(--warning)]">
              <i className="iconoir-warning-triangle" aria-hidden /> Como es un subdominio, usa Nombre/Host{' '}
              <span className="font-mono">{dnsRecord.host}</span> (no <span className="font-mono">@</span>).
            </p>
          )}
          <div className="px-4 pb-3">
            <a
              href={registrarGuides[detectedRegistrar].url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-accent)] hover:underline no-underline"
            >
              Abrir panel de {registrarGuides[detectedRegistrar].name} →
            </a>
          </div>
        </div>
      )}

      {/* Generic instructions when registrar unknown or undetected */}
      {(!detectedRegistrar || detectedRegistrar === 'unknown') && (
        <div className="bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-[var(--r-md)] px-4 py-3">
          <p className="text-xs font-semibold mb-2">Instrucciones generales:</p>
          <ol className="space-y-1.5">
            {[
              'Ve al panel de DNS de tu proveedor de dominio (GoDaddy, Namecheap, etc.)',
              `Crea un nuevo registro tipo ${dnsRecord?.type ?? 'CNAME'}`,
              `Nombre / Host: ${dnsRecord?.host ?? '@'} · Valor / Apunta a: ${dnsRecord?.value ?? CNAME_TARGET}`,
              'Guarda los cambios — la propagación puede tomar hasta 48 horas',
            ].map((step, i) => (
              <li key={i} className="flex gap-2 text-xs text-[var(--color-muted)]">
                <span className="flex-shrink-0 font-bold text-[var(--color-accent)]">{i + 1}.</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}
