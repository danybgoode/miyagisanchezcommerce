'use client'

import { useEffect, useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'

const ORIGIN = 'https://miyagisanchez.com'

type Visibility = 'public' | 'private'
type WidgetPosition = 'bottom-right' | 'bottom-left'

function moneyInput(onChange: (value: number) => void) {
  return (event: ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.target.value)
    onChange(Number.isFinite(next) ? next : 0)
  }
}

function MiniToggle({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${checked ? 'bg-[var(--color-accent)]' : 'bg-gray-300'}`}
      aria-pressed={checked}
    >
      <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${checked ? 'translate-x-5' : 'translate-x-1'}`} />
    </button>
  )
}

function htmlAttr(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function supportPreviewDoc({
  state,
  loaderSrc,
  keyValue,
  position,
  accent,
  enabled,
  presets,
  min,
  max,
  visibility,
}: {
  state: 'closed' | 'open'
  loaderSrc: string
  keyValue: string
  position: WidgetPosition
  accent: string
  enabled: boolean
  presets: number[]
  min: number
  max: number
  visibility: Visibility
}) {
  const widgetAttrs = [
    `data-preview="true"`,
    `data-preview-state="${state}"`,
    `data-layout="floating"`,
    `data-position="${position}"`,
    `data-key="${htmlAttr(keyValue)}"`,
    `data-accent="${htmlAttr(accent || '#1d6f42')}"`,
    `data-preview-enabled="${enabled ? 'true' : 'false'}"`,
    `data-preview-presets="${presets.map((value) => Math.round(value * 100)).join(',')}"`,
    `data-preview-min="${Math.round(min * 100)}"`,
    `data-preview-max="${Math.round(max * 100)}"`,
    `data-preview-currency="MXN"`,
    `data-preview-visibility="${visibility}"`,
    `data-preview-shop="tu tienda"`,
  ].join(' ')

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      overflow: hidden;
      background: #fbfaf7;
      color: #26231f;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .page {
      min-height: 100vh;
      padding: 18px 18px 76px;
      background:
        linear-gradient(180deg, rgba(255,255,255,.86), rgba(255,255,255,.72)),
        radial-gradient(circle at 12% 16%, rgba(29,111,66,.08), transparent 30%),
        #fbfaf7;
    }
    .bar, .line, .media, .pill { background: #eeece8; border-radius: 999px; }
    .bar { width: 128px; height: 18px; margin-bottom: 14px; }
    .line { height: 9px; margin-bottom: 9px; }
    .line.wide { width: min(92%, 440px); }
    .line.mid { width: min(74%, 340px); }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 24px; }
    .media { height: 78px; border: 1px solid #dedbd4; border-radius: 8px; background: #f0efeb; }
    .pill { width: 76px; height: 12px; margin-top: 14px; }
    miyagi-support-widget { position: relative; z-index: 2; }
    @media (max-width: 420px) {
      .page { padding: 14px 14px 74px; }
      .grid { grid-template-columns: 1fr; }
      .media { height: 58px; }
    }
  </style>
</head>
<body>
  <main class="page" aria-hidden="true">
    <div class="bar"></div>
    <div class="line wide"></div>
    <div class="line mid"></div>
    <div class="grid">
      <div class="media"></div>
      <div class="media"></div>
    </div>
    <div class="pill"></div>
  </main>
  <script src="${htmlAttr(loaderSrc)}" async></script>
  <miyagi-support-widget ${widgetAttrs}></miyagi-support-widget>
</body>
</html>`
}

export default function SupportWidgetSection({
  enabled,
  presetPesos,
  customMinPesos,
  customMaxPesos,
  defaultVisibility,
  accent,
  error,
  supportProductId,
  onEnabledChange,
  onPresetPesosChange,
  onCustomMinPesosChange,
  onCustomMaxPesosChange,
  onDefaultVisibilityChange,
}: {
  enabled: boolean
  presetPesos: number[]
  customMinPesos: number
  customMaxPesos: number
  defaultVisibility: Visibility
  accent: string
  error?: string
  supportProductId?: string | null
  onEnabledChange: (enabled: boolean) => void
  onPresetPesosChange: (index: number, value: number) => void
  onCustomMinPesosChange: (value: number) => void
  onCustomMaxPesosChange: (value: number) => void
  onDefaultVisibilityChange: (visibility: Visibility) => void
}) {
  const [key, setKey] = useState<string | null>(null)
  const [loadingKey, setLoadingKey] = useState(true)
  const [copied, setCopied] = useState(false)
  const [position, setPosition] = useState<WidgetPosition>('bottom-right')
  const [previewOrigin, setPreviewOrigin] = useState('')

  useEffect(() => {
    let alive = true
    fetch('/api/sell/embed-key')
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((data: { key?: string }) => {
        if (alive) setKey(data.key ?? null)
      })
      .catch(() => {
        if (alive) setKey(null)
      })
      .finally(() => {
        if (alive) setLoadingKey(false)
      })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    setPreviewOrigin(window.location.origin)
  }, [])

  const k = key ?? 'emb_pk_...'
  const accentAttr = accent && accent !== '#111' ? ` data-accent="${accent}"` : ''
  const positionAttr = ` data-position="${position}"`
  const previewSignature = `${k}|${enabled}|${presetPesos.join(',')}|${customMinPesos}|${customMaxPesos}|${defaultVisibility}|${accent}|${position}`
  const previewLoaderSrc = `${previewOrigin || ''}/embed.js?support-preview=${encodeURIComponent(previewSignature)}`
  const closedPreviewDoc = useMemo(() => supportPreviewDoc({
    state: 'closed',
    loaderSrc: previewLoaderSrc,
    keyValue: k,
    position,
    accent,
    enabled,
    presets: presetPesos,
    min: customMinPesos,
    max: customMaxPesos,
    visibility: defaultVisibility,
  }), [accent, customMaxPesos, customMinPesos, defaultVisibility, enabled, k, position, presetPesos, previewLoaderSrc])
  const openPreviewDoc = useMemo(() => supportPreviewDoc({
    state: 'open',
    loaderSrc: previewLoaderSrc,
    keyValue: k,
    position,
    accent,
    enabled,
    presets: presetPesos,
    min: customMinPesos,
    max: customMaxPesos,
    visibility: defaultVisibility,
  }), [accent, customMaxPesos, customMinPesos, defaultVisibility, enabled, k, position, presetPesos, previewLoaderSrc])
  const snippet =
    `<script src="${ORIGIN}/embed.js" async></script>\n` +
    `<miyagi-support-widget data-key="${k}"${accentAttr}${positionAttr}></miyagi-support-widget>`

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(snippet)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section id="apoyo" className="border border-[var(--color-border)] rounded-xl p-5 mb-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <h2 className="font-semibold text-sm uppercase tracking-wide text-[var(--color-muted)]">
              Apoyos
            </h2>
            <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-surface-alt)] text-[var(--color-muted)]">Widget</span>
          </div>
          <p className="text-xs text-[var(--color-muted)]">
            Recibe contribuciones rápidas desde blogs, newsletters o tu propia web.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{enabled ? 'Activo' : 'Inactivo'}</span>
          <MiniToggle checked={enabled} onChange={onEnabledChange} />
        </div>
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className={`space-y-5 ${enabled ? '' : 'opacity-60'}`}>
        <div>
          <p className="text-sm font-medium mb-2">Montos sugeridos</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {[0, 1, 2].map((index) => (
              <label key={index} className="block">
                <span className="mb-1 block text-xs text-[var(--color-muted)]">Monto {index + 1}</span>
                <div className="flex items-center rounded-lg border border-[var(--color-border)] bg-white px-3 py-2">
                  <span className="mr-2 text-sm text-[var(--color-muted)]">$</span>
                  <input
                    type="number"
                    min={1}
                    step={10}
                    value={presetPesos[index] ?? 0}
                    onChange={moneyInput((value) => onPresetPesosChange(index, value))}
                    className="w-full bg-transparent text-sm font-semibold outline-none"
                    disabled={!enabled}
                  />
                  <span className="ml-2 text-xs text-[var(--color-muted)]">MXN</span>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-xs text-[var(--color-muted)]">Mínimo personalizado</span>
            <div className="flex items-center rounded-lg border border-[var(--color-border)] bg-white px-3 py-2">
              <span className="mr-2 text-sm text-[var(--color-muted)]">$</span>
              <input
                type="number"
                min={1}
                step={10}
                value={customMinPesos}
                onChange={moneyInput(onCustomMinPesosChange)}
                className="w-full bg-transparent text-sm font-semibold outline-none"
                disabled={!enabled}
              />
            </div>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-[var(--color-muted)]">Máximo personalizado</span>
            <div className="flex items-center rounded-lg border border-[var(--color-border)] bg-white px-3 py-2">
              <span className="mr-2 text-sm text-[var(--color-muted)]">$</span>
              <input
                type="number"
                min={1}
                step={50}
                value={customMaxPesos}
                onChange={moneyInput(onCustomMaxPesosChange)}
                className="w-full bg-transparent text-sm font-semibold outline-none"
                disabled={!enabled}
              />
            </div>
          </label>
          <div>
            <span className="mb-1 block text-xs text-[var(--color-muted)]">Visibilidad inicial</span>
            <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-[var(--color-border)] bg-white">
              {(['public', 'private'] as const).map((visibility) => (
                <button
                  key={visibility}
                  type="button"
                  disabled={!enabled}
                  onClick={() => onDefaultVisibilityChange(visibility)}
                  className={`px-3 py-2 text-sm font-semibold ${defaultVisibility === visibility ? 'bg-[var(--color-accent)] text-white' : 'text-[var(--color-muted)] hover:bg-[var(--color-surface-alt)]'}`}
                >
                  {visibility === 'public' ? 'Público' : 'Privado'}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-[var(--color-border)] overflow-hidden">
          <div className="flex items-center justify-between gap-3 bg-[var(--color-surface-alt)] px-3 py-2">
            <div>
              <p className="text-sm font-semibold">Snippet de apoyo</p>
              <p className="text-xs text-[var(--color-muted)]">
                {supportProductId ? `Producto interno: ${supportProductId}` : enabled ? 'Se crea al guardar.' : 'Disponible al activar apoyos.'}
              </p>
            </div>
            <button
              type="button"
              onClick={copySnippet}
              disabled={loadingKey || !key}
              className="rounded bg-[var(--color-accent)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
            >
              {copied ? 'Copiado' : 'Copiar'}
            </button>
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all bg-white p-3 font-mono text-xs text-[var(--color-foreground)]">{snippet}</pre>
        </div>

        <div className="rounded-lg border border-[var(--color-border)] overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-[var(--color-surface-alt)] px-3 py-2">
            <div>
              <p className="text-sm font-semibold">Vista previa</p>
              <p className="text-xs text-[var(--color-muted)]">Así se verá el botón flotante en una página externa.</p>
            </div>
            <div className="grid grid-cols-2 overflow-hidden rounded-md border border-[var(--color-border)] bg-white">
              {([
                ['bottom-right', 'Derecha'],
                ['bottom-left', 'Izquierda'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPosition(value)}
                  className={`px-3 py-1.5 text-xs font-semibold ${position === value ? 'bg-[var(--color-accent)] text-white' : 'text-[var(--color-muted)] hover:bg-[var(--color-surface-alt)]'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-4 bg-white p-3 lg:grid-cols-[minmax(220px,0.85fr)_minmax(320px,1.15fr)]">
            <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-white">
              <div className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface-alt)] px-3 py-2">
                <p className="text-xs font-semibold text-[var(--color-foreground)]">Cerrado</p>
                <p className="text-[11px] text-[var(--color-muted)]">{position === 'bottom-right' ? 'Abajo derecha' : 'Abajo izquierda'}</p>
              </div>
              <iframe
                key={`${previewSignature}|closed`}
                title="Vista previa cerrada del widget de apoyo"
                srcDoc={closedPreviewDoc}
                sandbox="allow-scripts allow-popups"
                className="block h-[240px] w-full bg-white"
              />
            </div>

            <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-white">
              <div className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface-alt)] px-3 py-2">
                <p className="text-xs font-semibold text-[var(--color-foreground)]">Abierto</p>
                <p className="text-[11px] text-[var(--color-muted)]">{position === 'bottom-right' ? 'Abajo derecha' : 'Abajo izquierda'}</p>
              </div>
              <iframe
                key={`${previewSignature}|open`}
                title="Vista previa abierta del widget de apoyo"
                srcDoc={openPreviewDoc}
                sandbox="allow-scripts allow-popups"
                className="block h-[420px] w-full bg-white"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
