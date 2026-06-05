'use client'

import { useEffect, useState } from 'react'
import type { ChangeEvent } from 'react'

const ORIGIN = 'https://miyagisanchez.com'

type Visibility = 'public' | 'private'

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

  const k = key ?? 'emb_pk_...'
  const accentAttr = accent && accent !== '#111' ? ` data-accent="${accent}"` : ''
  const snippet =
    `<script src="${ORIGIN}/embed.js" async></script>\n` +
    `<miyagi-support-widget data-key="${k}"${accentAttr}></miyagi-support-widget>`

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
      </div>
    </section>
  )
}
