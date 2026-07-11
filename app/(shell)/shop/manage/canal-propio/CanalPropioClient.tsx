'use client'

/**
 * Canal propio — custom domain + free URL/slug editor + embed snippet.
 * Extracted out of the settings `Canal.tsx` mega-section (catalog-management
 * epic, Sprint 6 · Story 6.2) — federation-only; the support widget moved to
 * its own settings card (`settings/_sections/Apoyo.tsx`).
 *
 * Behavior-preserving: every external request fires identically — the
 * custom-domain flow hits `/api/sell/shop/domain` (GET/POST/DELETE),
 * `/domain/detect`, `/domain/cloudflare`; the slug editor hits
 * `/api/sell/shop/slug`. Both persist through their OWN endpoints, never
 * through `useSettingsSave()` — so unlike the old Canal.tsx, this component
 * has no page-level save bar/toast at all: nothing here ever fed one (that
 * machinery only ever gated the support-slice save, which moved to Apoyo.tsx).
 * Each domain/slug action already renders its own inline pending/error state.
 */

import { useState, useRef, useEffect } from 'react'
import { Banner } from '@/components/feedback/Banner'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Button } from '@/components/ui/Button'
import EmbedSnippetSection from './EmbedSnippetSection'
import SubdomainSection from './SubdomainSection'
import DomainPaywallUpsell from './DomainPaywallUpsell'
import { dnsRecordFor, CNAME_TARGET } from '@/lib/domain-utils'
import { SlugField, type SlugStatus } from '@/components/SlugField'

// ── Registrar DNS guides ──────────────────────────────────────────────────────
// Interpolate CNAME_TARGET (not a hardcoded literal) so a future provider swap
// only ever touches lib/domain-utils.ts — Sprint 4 (frontend-vercel-to-cloudrun)
// found 5 hardcoded copies of the old `cname.vercel-dns.com` string here.
const REGISTRAR_GUIDES: Record<string, { name: string; icon: string; url: string; steps: string[] }> = {
  cloudflare: {
    name: 'Cloudflare',
    icon: '☁️',
    url: 'https://dash.cloudflare.com',
    steps: [
      'Ve a dash.cloudflare.com → elige tu dominio',
      'En la barra lateral clic en "DNS" → "Agregar registro"',
      `Tipo: CNAME · Nombre: @ · Contenido: ${CNAME_TARGET}`,
      'Proxy (nube naranja): desactivar → DNS only · Guardar',
    ],
  },
  godaddy: {
    name: 'GoDaddy',
    icon: '🐐',
    url: 'https://dcc.godaddy.com/manage',
    steps: [
      'Ve a dcc.godaddy.com → Mis dominios → "Administrar DNS"',
      'Desplázate hasta "Registros CNAME" → clic en "Agregar"',
      `Host: @ · Apunta a: ${CNAME_TARGET} · TTL: 1 hora`,
      'Clic en "Guardar"',
    ],
  },
  namecheap: {
    name: 'Namecheap',
    icon: '🌐',
    url: 'https://ap.www.namecheap.com/domains/list',
    steps: [
      'Ve a namecheap.com → Domain List → "Manage" junto a tu dominio',
      'Pestaña "Advanced DNS" → "Add New Record"',
      `Tipo: CNAME Record · Host: @ · Value: ${CNAME_TARGET}`,
      'TTL: Automático → "Save All Changes"',
    ],
  },
  google: {
    name: 'Google Domains / Squarespace',
    icon: '🔠',
    url: 'https://domains.google.com',
    steps: [
      'Ve a domains.google.com → tu dominio → "DNS"',
      'En "Custom records" → "Manage custom records" → "Create new record"',
      `Tipo: CNAME · Nombre: (vacío o @) · Datos: ${CNAME_TARGET}`,
      'Clic en "Save"',
    ],
  },
  squarespace: {
    name: 'Squarespace',
    icon: '🔲',
    url: 'https://account.squarespace.com/domains',
    steps: [
      'Ve a account.squarespace.com/domains → tu dominio → "DNS settings"',
      'Clic en "Add record" → Tipo: CNAME',
      `Host: @ · Data: ${CNAME_TARGET}`,
      'Clic en "Save"',
    ],
  },
}

export interface CanalPropioInitial {
  slug?: string
  custom_domain?: string | null
  custom_domain_verified?: boolean
  /** Brand accent — feeds the embed preview. */
  accent?: string | null
  /**
   * Custom-domain paywall (epic: custom-domain-paywall, S1). False ⇒ render the
   * premium upsell instead of the connect form. Defaults true (ungated) so the
   * section is unchanged when the paywall flag is off / the seller is entitled.
   */
  domain_entitled?: boolean
  /**
   * Custom-domain paywall (S2). True when a previously-active custom-domain
   * subscription lapsed (cancel / past_due) and the domain was disconnected —
   * shows a "re-activate to restore your domain" prompt on the upsell.
   */
  domain_lapsed?: boolean
  /**
   * Promoter Program (epic 08, Sprint 1 — `promoter.enabled`, default off). When
   * true, the domain-subscribe block shows a promoter-code field + discount preview
   * before pay. The real charge with the discount is Sprint 2.
   */
  promoter_enabled?: boolean
  // Subdomain paywall (epic 07 · subdomain-pricing) — feed <SubdomainSection>.
  // entitled: false ⇒ show the buy upsell (defaults true/ungated). active: an active
  // recurring sub ⇒ show the cadence switch. has_monthly: $25/mo seeded ⇒ gate the
  // monthly options. lapsed: a sub lapsed ⇒ re-activate prompt.
  subdomain_entitled?: boolean
  subdomain_active?: boolean
  subdomain_has_monthly?: boolean
  subdomain_lapsed?: boolean
}

export default function CanalPropioClient({ initial }: { initial: CanalPropioInitial }) {
  const accentColor = initial.accent ?? '#1d6f42'

  // ── Own channel — custom domain ────────────────────────────────────────────
  const [shopSlug, setShopSlug]                     = useState(initial.slug ?? '')
  const [slugEditing, setSlugEditing]               = useState(false)
  const [slugInput, setSlugInput]                   = useState(initial.slug ?? '')
  const [slugStatus, setSlugStatus]                 = useState<SlugStatus>('idle')
  const [slugSaving, setSlugSaving]                 = useState(false)
  const [slugError, setSlugError]                   = useState<string | null>(null)
  const [slugCopied, setSlugCopied]                 = useState(false)
  const [subCopied, setSubCopied]                   = useState(false)
  const [shortCopied, setShortCopied]               = useState(false)
  const [domainInput, setDomainInput]               = useState(initial.custom_domain ?? '')
  const [savedDomain, setSavedDomain]               = useState(initial.custom_domain ?? '')
  const [domainDnsOk, setDomainDnsOk]               = useState(initial.custom_domain_verified ?? false)
  const [domainSslReady, setDomainSslReady]         = useState(initial.custom_domain_verified ?? false)
  const [domainCnameCurrent, setDomainCnameCurrent] = useState<string | null>(null)
  const [domainHint, setDomainHint]                 = useState<string | null>(null)
  const [domainSaving, setDomainSaving]             = useState(false)
  const [domainChecking, setDomainChecking]         = useState(false)
  const [domainRemoving, setDomainRemoving]         = useState(false)
  const [domainEditing, setDomainEditing]           = useState(false)
  const [domainError, setDomainError]               = useState<string | null>(null)
  const [domainRemovedNote, setDomainRemovedNote]   = useState<string | null>(null)
  const [domainCopied, setDomainCopied]             = useState(false)
  const [domainLastChecked, setDomainLastChecked]   = useState<Date | null>(null)
  const [detectedRegistrar, setDetectedRegistrar]   = useState<string | null>(null)
  const [cfTokenInput, setCfTokenInput]             = useState('')
  const [cfSaving, setCfSaving]                     = useState(false)
  const [cfError, setCfError]                       = useState<string | null>(null)
  const [cfSuccess, setCfSuccess]                   = useState(false)
  const [showCfPanel, setShowCfPanel]               = useState(false)
  const domainPollRef                               = useRef<ReturnType<typeof setInterval> | null>(null)
  // Custom-domain paywall buy upsell — state + POST moved to <DomainPaywallUpsell>.

  // Auto-poll DNS every 8s after domain is saved, until live or 5 min elapsed
  function startDomainPolling() {
    stopDomainPolling()
    const deadline = Date.now() + 5 * 60 * 1000
    domainPollRef.current = setInterval(async () => {
      if (Date.now() > deadline) { stopDomainPolling(); return }
      const ok = await checkDomainDns()
      if (ok) stopDomainPolling()
    }, 8000)
  }
  function stopDomainPolling() {
    if (domainPollRef.current) { clearInterval(domainPollRef.current); domainPollRef.current = null }
  }
  useEffect(() => () => stopDomainPolling(), []) // cleanup on unmount

  // Refresh real DNS + SSL status once on load when a domain is already saved.
  useEffect(() => {
    if (savedDomain) checkDomainDns()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function checkDomainDns(): Promise<boolean> {
    setDomainChecking(true)
    try {
      const res = await fetch('/api/sell/shop/domain')
      if (!res.ok) return false
      const data = await res.json() as { dns_ok?: boolean; cname_current?: string | null; verified?: boolean; hint?: string | null }
      const ok = data.dns_ok ?? false
      setDomainDnsOk(ok)
      setDomainSslReady(!!data.verified)
      setDomainCnameCurrent(data.cname_current ?? null)
      setDomainHint(data.hint ?? null)
      setDomainLastChecked(new Date())
      return ok && !!data.verified
    } catch { return false }
    finally { setDomainChecking(false) }
  }

  async function handleDomainSave() {
    const domainRaw = domainInput.trim()
    if (domainEditing && domainRaw.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '') === savedDomain) {
      setDomainEditing(false); return
    }
    setDomainSaving(true); setDomainError(null); setDomainRemovedNote(null)
    try {
      const res = await fetch('/api/sell/shop/domain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: domainRaw }),
      })
      const data = await res.json() as { domain?: string; error?: string }
      if (!res.ok) { setDomainError(data.error ?? 'Error al guardar.'); return }
      const domain = data.domain ?? domainRaw
      setSavedDomain(domain)
      setDomainEditing(false)
      setDomainDnsOk(false)
      setDomainSslReady(false)
      setDomainCnameCurrent(null)
      setDomainHint(null)
      setDomainLastChecked(null)
      setDetectedRegistrar(null)
      setCfSuccess(false)
      startDomainPolling()

      fetch(`/api/sell/shop/domain/detect?domain=${encodeURIComponent(domain)}`)
        .then(r => r.ok ? r.json() : null)
        .then((d: { registrar?: string } | null) => {
          if (d?.registrar) {
            setDetectedRegistrar(d.registrar)
            if (d.registrar === 'cloudflare') setShowCfPanel(true)
          }
        })
        .catch(() => { /* non-fatal */ })
    } catch { setDomainError('Sin conexión. Verifica tu internet.') }
    finally { setDomainSaving(false) }
  }

  async function handleDomainVerifyManual() {
    setDomainError(null)
    await checkDomainDns()
  }

  function startDomainEdit() {
    setDomainInput(savedDomain)
    setDomainEditing(true)
    setDomainError(null)
  }
  function cancelDomainEdit() {
    setDomainEditing(false)
    setDomainInput(savedDomain)
    setDomainError(null)
  }

  async function handleDomainRemove() {
    if (!confirm(`¿Eliminar el dominio ${savedDomain}? Tu tienda solo estará disponible en miyagisanchez.com.`)) return
    const removed = savedDomain
    setDomainRemoving(true); setDomainError(null)
    stopDomainPolling()
    try {
      const res = await fetch('/api/sell/shop/domain', { method: 'DELETE' })
      if (!res.ok) { const d = await res.json() as { error?: string }; setDomainError(d.error ?? 'Error.'); return }
      setSavedDomain(''); setDomainInput(''); setDomainDnsOk(false); setDomainSslReady(false)
      setDomainEditing(false)
      setDomainCnameCurrent(null); setDomainHint(null); setDomainLastChecked(null)
      setDomainRemovedNote(removed)
    } catch { setDomainError('Sin conexión. Verifica tu internet.') }
    finally { setDomainRemoving(false) }
  }

  async function handleCfAutoConfig() {
    setCfSaving(true); setCfError(null); setCfSuccess(false)
    try {
      const res = await fetch('/api/sell/shop/domain/cloudflare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cf_token: cfTokenInput.trim() }),
      })
      const data = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok) { setCfError(data.error ?? 'Error al configurar.'); return }
      setCfSuccess(true); setCfTokenInput('')
      startDomainPolling()
    } catch { setCfError('Sin conexión.') }
    finally { setCfSaving(false) }
  }

  // ── Slug editor ────────────────────────────────────────────────────────────
  const shopUrl = `miyagisanchez.com/s/${shopSlug}`
  const subdomainUrl = `${shopSlug}.miyagisanchez.com`
  const shortUrl = `mschz.org/${shopSlug}`
  function startSlugEdit() { setSlugInput(shopSlug); setSlugStatus('idle'); setSlugError(null); setSlugEditing(true) }
  function cancelSlugEdit() { setSlugInput(shopSlug); setSlugEditing(false); setSlugError(null) }
  function copyShopUrl() {
    navigator.clipboard.writeText(`https://${shopUrl}`)
    setSlugCopied(true); setTimeout(() => setSlugCopied(false), 2000)
  }
  function copySubdomainUrl() {
    navigator.clipboard.writeText(`https://${subdomainUrl}`)
    setSubCopied(true); setTimeout(() => setSubCopied(false), 2000)
  }
  function copyShortUrl() {
    navigator.clipboard.writeText(`https://${shortUrl}`)
    setShortCopied(true); setTimeout(() => setShortCopied(false), 2000)
  }
  async function handleSlugSave() {
    const next = slugInput.trim().toLowerCase()
    if (next === shopSlug) { setSlugEditing(false); return }
    setSlugSaving(true); setSlugError(null)
    try {
      const res = await fetch('/api/sell/shop/slug', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: next }),
      })
      const data = await res.json() as { slug?: string; error?: string }
      if (!res.ok || !data.slug) { setSlugError(data.error ?? 'No se pudo cambiar.'); return }
      setShopSlug(data.slug)
      setSlugEditing(false)
    } catch { setSlugError('Sin conexión. Intenta de nuevo.') }
    finally { setSlugSaving(false) }
  }
  const slugSaveBlocked = slugSaving || slugStatus === 'taken' || slugStatus === 'invalid' || slugStatus === 'checking'

  const dnsRecord = savedDomain ? dnsRecordFor(savedDomain) : null

  type DomainStatus = 'active' | 'provisioning' | 'error' | 'unverified' | 'pending_dns' | 'none'
  const domainStatus: DomainStatus = (() => {
    if (!savedDomain) return 'none'
    if (domainError) return 'error'
    if (domainDnsOk) return domainSslReady ? 'active' : 'provisioning'
    if (domainCnameCurrent && domainCnameCurrent !== CNAME_TARGET) return 'error'
    if (domainLastChecked) return 'unverified'
    return 'pending_dns'
  })()

  return (
    <div>
      {/* ════════════════════════════════════════════════════════════════════
          Canal Propio — custom domain + free URL
      ════════════════════════════════════════════════════════════════════ */}
      <section id="canal" className="border border-[var(--color-border)] rounded-[var(--r-lg)] overflow-hidden mb-5">

        {/* ── Header ── */}
        <div className="px-5 pt-5 pb-4 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2 mb-1">
            <h2 className="font-semibold text-sm uppercase tracking-wide text-[var(--color-muted)]">
              Canal Propio
            </h2>
            {domainStatus === 'active' && (
              <StatusBadge token="success">🟢 Dominio activo</StatusBadge>
            )}
            {domainStatus === 'provisioning' && (
              <StatusBadge token="info">● Emitiendo SSL…</StatusBadge>
            )}
            {domainStatus === 'error' && (
              <StatusBadge token="danger">● Revisa la configuración</StatusBadge>
            )}
            {domainStatus === 'unverified' && (
              <StatusBadge token="warning">● Aún no apunta a nosotros</StatusBadge>
            )}
            {domainStatus === 'pending_dns' && (
              <StatusBadge token="warning">
                {domainChecking ? '● Comprobando…' : '● Configurando DNS…'}
              </StatusBadge>
            )}
          </div>
          <p className="text-xs text-[var(--color-muted)]">
            Tu tienda en tu dominio, sin comisiones ni marca ajena.
            Tus clientes llegan a <strong>tutienda.mx</strong> — nosotros manejamos todo el comercio por atrás.
          </p>
        </div>

        <div className="px-5 py-5 space-y-6">

          {/* ══ Free shop URL (slug) ═══════════════════════════════════════════ */}
          <div className="rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-4">
            <div className="flex items-center justify-between gap-2 mb-1">
              <h3 className="text-sm font-medium">Tu URL gratis</h3>
              <StatusBadge token="success" className="uppercase tracking-wide">Incluida</StatusBadge>
            </div>
            {!slugEditing ? (
              <>
                <div className="flex items-center gap-2 mt-2">
                  <code className="flex-1 min-w-0 truncate text-sm font-mono bg-[var(--bg-elevated)] border border-[var(--color-border)] rounded-[var(--r-sm)] px-3 py-2">
                    {shopUrl}
                  </code>
                  <button
                    type="button"
                    onClick={copyShopUrl}
                    className={`text-xs px-3 py-2 rounded-[var(--r-sm)] transition-colors whitespace-nowrap ${slugCopied ? 'bg-[var(--success-soft)] text-[var(--success)]' : 'bg-[var(--color-surface)] border border-[var(--color-border)] hover:bg-[var(--color-surface-alt)]'}`}
                  >
                    {slugCopied ? '✓ Copiado' : 'Copiar'}
                  </button>
                  <button
                    type="button"
                    onClick={startSlugEdit}
                    className="text-xs px-3 py-2 rounded-[var(--r-sm)] border border-[var(--color-border)] hover:bg-[var(--color-surface)] whitespace-nowrap"
                  >
                    Cambiar
                  </button>
                </div>
                {/* Subdomain alias */}
                <div className="flex items-center gap-2 mt-2">
                  <code className="flex-1 min-w-0 truncate text-sm font-mono bg-[var(--bg-elevated)] border border-[var(--color-border)] rounded-[var(--r-sm)] px-3 py-2">
                    {subdomainUrl}
                  </code>
                  <button
                    type="button"
                    onClick={copySubdomainUrl}
                    className={`text-xs px-3 py-2 rounded-[var(--r-sm)] transition-colors whitespace-nowrap ${subCopied ? 'bg-[var(--success-soft)] text-[var(--success)]' : 'bg-[var(--color-surface)] border border-[var(--color-border)] hover:bg-[var(--color-surface-alt)]'}`}
                  >
                    {subCopied ? '✓ Copiado' : 'Copiar'}
                  </button>
                </div>
                {/* Ultra-short branded link */}
                <div className="flex items-center gap-2 mt-2">
                  <code className="flex-1 min-w-0 truncate text-sm font-mono bg-[var(--bg-elevated)] border border-[var(--color-border)] rounded-[var(--r-sm)] px-3 py-2">
                    {shortUrl}
                  </code>
                  <button
                    type="button"
                    onClick={copyShortUrl}
                    className={`text-xs px-3 py-2 rounded-[var(--r-sm)] transition-colors whitespace-nowrap ${shortCopied ? 'bg-[var(--success-soft)] text-[var(--success)]' : 'bg-[var(--color-surface)] border border-[var(--color-border)] hover:bg-[var(--color-surface-alt)]'}`}
                  >
                    {shortCopied ? '✓ Copiado' : 'Copiar'}
                  </button>
                </div>
                <p className="text-xs text-[var(--color-muted)] mt-2">
                  <span className="font-mono">{shortUrl}</span> es tu enlace ultra-corto para bios y redes.
                  Tu tienda también vive en <span className="font-mono">{subdomainUrl}</span> — un enlace
                  más corto y con tu marca. Compártelos en redes y tarjetas. ¿Quieres tu propio dominio
                  sin <span className="font-mono">/s/</span>?{' '}
                  <a href="#canal" onClick={(e) => { e.preventDefault(); document.getElementById('canal')?.scrollIntoView({ behavior: 'smooth' }) }} className="text-[var(--color-accent)] hover:underline">
                    Mejora a dominio propio ↓
                  </a>
                </p>

                {/* Subdomain paywall — buy + monthly↔yearly switch (epic 07 ·
                    subdomain-pricing). Extracted to its own section (Canal is at the
                    anti-monolith line cap); invisible for a grandfathered shop with no
                    subscription other than a small "incluido" note. */}
                <SubdomainSection
                  subdomainUrl={subdomainUrl}
                  shopSlug={shopSlug}
                  entitled={initial.subdomain_entitled ?? true}
                  active={initial.subdomain_active ?? false}
                  hasMonthly={initial.subdomain_has_monthly ?? false}
                  lapsed={initial.subdomain_lapsed ?? false}
                />
              </>
            ) : (
              <div className="mt-2 space-y-3">
                <SlugField
                  value={slugInput}
                  onChange={setSlugInput}
                  currentSlug={shopSlug}
                  onStatusChange={setSlugStatus}
                  label="Elige tu nueva URL"
                  autoFocus
                />
                {slugError && <p className="text-xs text-[var(--danger)]">{slugError}</p>}
                <p className="text-xs text-[var(--color-muted)]">
                  Tu URL anterior seguirá redirigiendo aquí por 90 días.
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={handleSlugSave}
                    disabled={slugSaveBlocked}
                  >
                    {slugSaving ? 'Guardando…' : 'Guardar URL'}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={cancelSlugEdit}
                  >
                    Cancelar
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* ══ Custom-domain paywall (epic: custom-domain-paywall, S1) ═══════
              The connect steps below are the premium SKU. When the shop is not
              entitled (flag on, no grandfather/comp grant, no subscription) we
              render the upsell instead — the free shop URL / subdomain section
              above stays fully available. Defaults to entitled (unchanged) when
              the prop is absent or the paywall flag is off. */}
          {!(initial.domain_entitled ?? true) ? (
            <DomainPaywallUpsell
              domainLapsed={initial.domain_lapsed ?? false}
              promoterEnabled={initial.promoter_enabled ?? false}
            />
          ) : (
          <>
          {/* ══ STEP 1 — Enter domain ════════════════════════════════════════ */}
          <div className="flex gap-2 items-start">
            <div className={`w-6 h-6 rounded-[var(--r-pill)] flex-shrink-0 flex items-center justify-center text-xs font-bold mt-0.5 ${savedDomain ? 'bg-[var(--color-accent)] text-white' : 'bg-[var(--color-surface-alt)] border border-[var(--color-border)] text-[var(--color-muted)]'}`}>
              {savedDomain ? '✓' : '1'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium mb-2">
                {domainEditing ? 'Cambia tu dominio' : savedDomain ? 'Dominio registrado' : 'Ingresa tu dominio'}
              </p>

              {!savedDomain && domainRemovedNote && (
                <Banner variant="success" className="mb-3">
                  Dominio <span className="font-mono">{domainRemovedNote}</span> eliminado. Tu tienda sigue
                  activa en <span className="font-mono">miyagisanchez.com/s/{shopSlug}</span>.
                </Banner>
              )}

              {(!savedDomain || domainEditing) ? (
                <>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={domainInput}
                      onChange={e => setDomainInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && !domainSaving && domainInput.trim() && handleDomainSave()}
                      placeholder="tutienda.mx"
                      className="flex-1 min-w-0 border border-[var(--color-border)] rounded-[var(--r-sm)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] font-mono"
                    />
                    <div className="flex gap-2">
                      {domainEditing && (
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={cancelDomainEdit}
                          disabled={domainSaving}
                          className="flex-1 sm:flex-none whitespace-nowrap"
                        >
                          Cancelar
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="primary"
                        onClick={handleDomainSave}
                        disabled={domainSaving || !domainInput.trim()}
                        className="flex-1 sm:flex-none whitespace-nowrap"
                      >
                        {domainSaving ? (domainEditing ? 'Reemplazando…' : 'Conectando…') : (domainEditing ? 'Reemplazar' : 'Conectar')}
                      </Button>
                    </div>
                  </div>
                  {domainEditing ? (
                    <p className="text-xs text-[var(--color-muted)] mt-2">
                      Tu dominio actual sigue activo hasta que el nuevo quede listo.
                    </p>
                  ) : (
                    <p className="text-xs text-[var(--color-muted)] mt-2">
                      ¿No tienes dominio?{' '}
                      <a href="https://www.cloudflare.com/products/registrar/" target="_blank" rel="noopener noreferrer"
                        className="text-[var(--color-accent)] underline">
                        Regístralo a precio de costo en Cloudflare →
                      </a>
                    </p>
                  )}
                </>
              ) : (
                <div>
                  <div className="flex items-center justify-between gap-3 p-2.5 rounded-[var(--r-md)] bg-[var(--color-surface-alt)] border border-[var(--color-border)]">
                    <span className="font-mono text-sm font-medium truncate">{savedDomain}</span>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <button
                        type="button"
                        onClick={startDomainEdit}
                        disabled={domainRemoving}
                        className="text-xs text-[var(--color-muted)] hover:text-[var(--color-accent)] transition-colors disabled:opacity-50 underline"
                      >
                        Cambiar
                      </button>
                      <button
                        type="button"
                        onClick={handleDomainRemove}
                        disabled={domainRemoving}
                        className="text-xs text-[var(--color-muted)] hover:text-[var(--danger)] transition-colors disabled:opacity-50 underline"
                      >
                        {domainRemoving ? 'Eliminando…' : 'Eliminar'}
                      </button>
                    </div>
                  </div>
                  {detectedRegistrar && detectedRegistrar !== 'unknown' && !domainDnsOk && (
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
                      <span>{REGISTRAR_GUIDES[detectedRegistrar]?.icon ?? '🌐'}</span>
                      <span>
                        Registrador detectado:{' '}
                        <strong className="text-[var(--color-foreground)]">
                          {REGISTRAR_GUIDES[detectedRegistrar]?.name ?? detectedRegistrar}
                        </strong>
                      </span>
                    </div>
                  )}
                </div>
              )}
              {domainError && <p className="mt-2 text-xs text-[var(--danger)]">⚠ {domainError}</p>}
            </div>
          </div>

          {/* ══ STEP 2 — Configure DNS ═══════════════════════════════════════ */}
          {savedDomain && (
            <div className={`flex gap-2 items-start transition-opacity ${domainDnsOk ? 'opacity-50' : ''}`}>
              <div className={`w-6 h-6 rounded-[var(--r-pill)] flex-shrink-0 flex items-center justify-center text-xs font-bold mt-0.5 ${domainDnsOk ? 'bg-[var(--color-accent)] text-white' : 'bg-[var(--color-surface-alt)] border-2 border-[var(--color-accent)] text-[var(--color-accent)]'}`}>
                {domainDnsOk ? '✓' : '2'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium mb-1">
                  {domainDnsOk ? 'DNS configurado ✓' : 'Apunta tu dominio a Miyagi Sánchez'}
                </p>
                <p className="text-xs text-[var(--color-muted)] mb-3">
                  {domainDnsOk
                    ? `${savedDomain} apunta correctamente a nuestros servidores.`
                    : `Agrega este registro ${dnsRecord?.type ?? 'CNAME'} en el panel de DNS de tu dominio.`
                  }
                </p>

                {domainHint === 'proxied' && (
                  <Banner variant="warning" className="mb-3">
                    Tu dominio está detrás del proxy de Cloudflare (la nube naranja). Desactívalo
                    para que quede en <span className="font-medium">DNS only</span> (nube gris) — necesitamos
                    ver tu dominio directamente para emitir el certificado SSL.
                  </Banner>
                )}
                {domainStatus === 'error' && domainCnameCurrent && (
                  <Banner variant="danger" className="mb-3">
                    Tu {dnsRecord?.type ?? 'CNAME'} apunta a <span className="font-mono break-all">{domainCnameCurrent}</span>.
                    Cámbialo a <span className="font-mono break-all">{dnsRecord?.value ?? CNAME_TARGET}</span> para conectar tu tienda.
                  </Banner>
                )}
                {domainStatus === 'unverified' && (
                  <Banner variant="warning" className="mb-3">
                    Tu dominio aún no apunta a nosotros. Agrega el registro de abajo en tu proveedor de
                    DNS; en cuanto propague, tu tienda se activa sola.
                  </Banner>
                )}

                {/* DNS record card — terminal style (dark preview theme; the amber/green/white
                    text inside is a deliberate terminal color scheme, not a status indicator —
                    same exemption as the code-preview block in Agentes.tsx). */}
                <div className="rounded-[var(--r-md)] border border-[var(--border)] overflow-hidden bg-[var(--preview-ink)] mb-4">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
                    <span className="text-xs text-white/50 font-mono">Registro DNS — {dnsRecord?.type ?? 'CNAME'}</span>
                    <button
                      type="button"
                      onClick={() => { navigator.clipboard.writeText(dnsRecord?.value ?? CNAME_TARGET); setDomainCopied(true); setTimeout(() => setDomainCopied(false), 2000) }}
                      className={`text-xs px-2 py-0.5 rounded-[var(--r-sm)] transition-all ${domainCopied ? 'bg-green-500/20 text-green-400' : 'bg-white/10 text-white/60 hover:bg-white/20 hover:text-white'}`}
                    >
                      {domainCopied ? '✓ Copiado' : 'Copiar valor'}
                    </button>
                  </div>
                  <div className="px-3 py-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs font-mono">
                    <div><div className="text-white/30 mb-1">TIPO</div><div className="text-amber-300">{dnsRecord?.type ?? 'CNAME'}</div></div>
                    <div><div className="text-white/30 mb-1">NOMBRE</div><div className="text-white break-all">{dnsRecord?.host ?? '@'}</div></div>
                    <div><div className="text-white/30 mb-1">VALOR</div><div className="text-green-300 break-all">{dnsRecord?.value ?? CNAME_TARGET}</div></div>
                  </div>
                </div>

                {!domainDnsOk && dnsRecord?.isApex && (
                  <p className="text-xs text-[var(--color-muted)] -mt-2 mb-4">
                    Este es un dominio raíz (sin "www"): tu proveedor de DNS necesita soportar un
                    registro CNAME (o ALIAS/ANAME) en la raíz — la mayoría de los proveedores
                    modernos lo permiten (Cloudflare, y muchos otros vía "flattening").
                  </p>
                )}

                {/* ── Context-aware DNS setup panels ────────────────────────── */}
                {!domainDnsOk && (
                  <div className="space-y-3 mb-3">

                    {/* Cloudflare auto-config */}
                    <div className={`border rounded-[var(--r-md)] overflow-hidden ${detectedRegistrar === 'cloudflare' ? 'border-orange-300 bg-orange-50/30' : 'border-[var(--color-border)]'}`}>
                      <button
                        type="button"
                        onClick={() => setShowCfPanel(v => !v)}
                        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[var(--color-surface-alt)] transition-colors"
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="text-lg">☁️</span>
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
                              <span>☁️</span> Abrir Cloudflare → Crear token
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
                                onChange={e => setCfTokenInput(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && cfTokenInput.trim() && !cfSaving && handleCfAutoConfig()}
                                placeholder="Pega tu API Token aquí"
                                autoComplete="off"
                                className="flex-1 border border-[var(--color-border)] rounded-[var(--r-sm)] px-3 py-2 text-sm bg-[var(--bg-elevated)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                              />
                              <Button
                                type="button"
                                variant="primary"
                                onClick={handleCfAutoConfig}
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
                            🔒 El token se usa una sola vez para crear el registro y no se almacena en nuestros servidores.
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Per-registrar step-by-step (non-CF known registrars) */}
                    {detectedRegistrar && detectedRegistrar !== 'cloudflare' && detectedRegistrar !== 'unknown' && REGISTRAR_GUIDES[detectedRegistrar] && (
                      <div className="border border-[var(--color-border)] rounded-[var(--r-md)] overflow-hidden">
                        <div className="flex items-center gap-2.5 px-4 py-3 bg-[var(--color-surface-alt)] border-b border-[var(--color-border)]">
                          <span className="text-base">{REGISTRAR_GUIDES[detectedRegistrar].icon}</span>
                          <div>
                            <p className="text-xs font-semibold">
                              Instrucciones para {REGISTRAR_GUIDES[detectedRegistrar].name}
                            </p>
                            <p className="text-xs text-[var(--color-muted)]">
                              Detectamos que tu dominio está en {REGISTRAR_GUIDES[detectedRegistrar].name}
                            </p>
                          </div>
                        </div>
                        <ol className="px-4 py-3 space-y-2">
                          {REGISTRAR_GUIDES[detectedRegistrar].steps.map((step, i) => (
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
                            ⚠ Como es un subdominio, usa Nombre/Host{' '}
                            <span className="font-mono">{dnsRecord.host}</span> (no <span className="font-mono">@</span>).
                          </p>
                        )}
                        <div className="px-4 pb-3">
                          <a
                            href={REGISTRAR_GUIDES[detectedRegistrar].url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-accent)] hover:underline no-underline"
                          >
                            Abrir panel de {REGISTRAR_GUIDES[detectedRegistrar].name} →
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
                )}

                {/* Live status row */}
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
                    {domainChecking ? (
                      <>
                        <span className="inline-block w-3 h-3 rounded-[var(--r-pill)] border-2 border-[var(--color-accent)] border-t-transparent animate-spin" />
                        <span>Comprobando propagación DNS…</span>
                      </>
                    ) : domainStatus === 'error' && domainCnameCurrent ? (
                      <>
                        <span className="text-[var(--danger)]">⚠</span>
                        <span>
                          CNAME actual: <span className="font-mono break-all">{domainCnameCurrent}</span> — apunta a otro lugar
                        </span>
                      </>
                    ) : domainStatus === 'unverified' ? (
                      <span>Tu dominio aún no apunta a nosotros — última comprobación: {domainLastChecked?.toLocaleTimeString()}</span>
                    ) : !domainDnsOk ? (
                      <span>Configurando DNS — comprobando automáticamente cada 8 segundos…</span>
                    ) : null}
                  </div>
                  {!domainDnsOk && (
                    <button
                      type="button"
                      onClick={handleDomainVerifyManual}
                      disabled={domainChecking}
                      className="text-xs px-3 py-1.5 border border-[var(--color-border)] rounded-[var(--r-md)] hover:bg-[var(--color-surface-alt)] transition-colors disabled:opacity-50 whitespace-nowrap flex-shrink-0"
                    >
                      {domainChecking ? 'Comprobando…' : '↻ Comprobar ahora'}
                    </button>
                  )}
                </div>
                {!domainDnsOk && (
                  <p className="text-xs text-[var(--color-muted)] mt-2">
                    Configurando DNS, puede tomar entre 5 minutos y 48 horas según tu proveedor.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ══ STEP 3 — Live / dual channel display ═════════════════════════ */}
          {savedDomain && (
            <div className={`flex gap-2 items-start transition-all ${!domainDnsOk ? 'opacity-40 pointer-events-none select-none' : ''}`}>
              <div className={`w-6 h-6 rounded-[var(--r-pill)] flex-shrink-0 flex items-center justify-center text-xs font-bold mt-0.5 ${domainDnsOk ? 'bg-[var(--color-accent)] text-white' : 'bg-[var(--color-surface-alt)] border border-[var(--color-border)] text-[var(--color-muted)]'}`}>
                {domainDnsOk ? '✓' : '3'}
              </div>
              <div className="flex-1 min-w-0">
                {domainStatus === 'active' ? (
                  <>
                    <p className="text-sm font-semibold mb-3">🎉 ¡Tu tienda está activa en 2 canales!</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">

                      {/* Canal propio */}
                      <div className="border-2 border-[var(--color-accent)] rounded-[var(--r-lg)] p-4 bg-[color-mix(in_srgb,var(--color-accent)_5%,white)]">
                        <div className="flex items-center gap-1.5 mb-2">
                          <span className="text-sm">🌐</span>
                          <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-accent)]">
                            Canal Propio
                          </span>
                        </div>
                        <p className="font-mono text-sm font-semibold truncate mb-1">{savedDomain}</p>
                        <p className="text-xs text-[var(--color-muted)] mb-3 leading-relaxed">
                          Tu dominio, tu marca. Sin miyagisanchez.com en la URL. SSL activo, infraestructura nuestra.
                        </p>
                        <a
                          href={`https://${savedDomain}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-accent)] hover:underline no-underline"
                        >
                          Abrir tienda →
                        </a>
                      </div>

                      {/* Canal marketplace */}
                      <div className="border border-[var(--color-border)] rounded-[var(--r-lg)] p-4 bg-[var(--color-surface-alt)]">
                        <div className="flex items-center gap-1.5 mb-2">
                          <span className="text-sm">🏪</span>
                          <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-muted)]">
                            Miyagi Sánchez
                          </span>
                        </div>
                        <p className="font-mono text-xs font-medium text-[var(--color-muted)] truncate mb-1">
                          miyagisanchez.com/s/{shopSlug}
                        </p>
                        <p className="text-xs text-[var(--color-muted)] mb-3 leading-relaxed">
                          Visible en el marketplace para descubrimiento y SEO. Sin cambios.
                        </p>
                        {shopSlug && (
                          <a
                            href={`/s/${shopSlug}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-muted)] hover:text-[var(--color-foreground)] no-underline hover:underline"
                          >
                            Ver en marketplace →
                          </a>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-[var(--color-muted)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-[var(--r-md)] px-3 py-2 leading-relaxed">
                      💡 Los dos canales comparten el mismo inventario, checkout y panel de administración. Cada venta se etiqueta con su canal de origen para que puedas ver de dónde vienen tus clientes.
                    </p>
                  </>
                ) : domainStatus === 'provisioning' ? (
                  <>
                    <p className="text-sm font-medium mb-1">DNS correcto ✓ — emitiendo certificado SSL…</p>
                    <p className="text-xs text-[var(--color-muted)] leading-relaxed">
                      Tu dominio ya apunta a nosotros. Estamos emitiendo el certificado SSL (suele tardar uno o
                      dos minutos). En cuanto esté listo, tu tienda abrirá con candado seguro 🔒.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium mb-1">Tu tienda estará lista en cuanto propague el DNS</p>
                    <p className="text-xs text-[var(--color-muted)]">
                      SSL activado automáticamente. Verás aquí los links a tus dos canales.
                    </p>
                  </>
                )}
              </div>
            </div>
          )}
          </>
          )}

        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          Embeddable widget — snippet generator (display-only)
      ════════════════════════════════════════════════════════════════════ */}
      <EmbedSnippetSection slug={shopSlug} accent={accentColor} />
    </div>
  )
}
