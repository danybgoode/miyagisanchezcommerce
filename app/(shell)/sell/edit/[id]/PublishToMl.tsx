'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  pickCategory,
  mlPublishView,
  type MlCategoryCandidate,
  type MlLinkView,
} from '@/lib/ml-publish'

/**
 * Publish / sync a Miyagi product to Mercado Libre (epic 03 · S3 · US-7/US-8/US-9).
 * Client island on the listing edit surface. When NOT linked: predicts a valid ML
 * category (override + low-confidence choice, US-9) then publishes + persists the
 * linkage. When linked: shows the ML permalink + status and a "Sincronizar"/
 * "Reabrir" action. No token ever reaches the client.
 *
 * Rendered only for connected sellers behind `ml.publish_enabled` (the page gates).
 */

type Step = 'idle' | 'category' | 'busy' | 'done'

export default function PublishToMl({
  productId,
  title,
  initialLink,
}: {
  productId: string
  title: string
  initialLink: MlLinkView
}) {
  const router = useRouter()
  const [link, setLink] = useState<MlLinkView>(initialLink)
  const [step, setStep] = useState<Step>('idle')
  const [error, setError] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<MlCategoryCandidate[]>([])
  const [chosen, setChosen] = useState<string>('')
  const [needsChoice, setNeedsChoice] = useState(false)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  const view = mlPublishView(link)

  // ── Linked: sync / reopen (no category step — the backend reconciles) ──────────
  async function sync() {
    setStep('busy')
    setError(null)
    setOkMsg(null)
    try {
      const res = await fetch('/api/sell/ml/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d?.error ?? 'No se pudo sincronizar.')
      setLink((prev) => (prev ? { ...prev, ml_status: d.status ?? prev.ml_status, permalink: d.permalink ?? prev.permalink } : prev))
      setOkMsg(d.action === 'close' ? 'Publicación cerrada en Mercado Libre.' : d.action === 'relist' ? 'Publicación reabierta y actualizada.' : 'Publicación actualizada en Mercado Libre.')
      setStep('done')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo sincronizar.')
      setStep('idle')
    }
  }

  // ── Not linked: open the category step (predict → override/choose) ─────────────
  async function startPublish() {
    setStep('busy')
    setError(null)
    setOkMsg(null)
    try {
      const res = await fetch(`/api/sell/ml/predict?q=${encodeURIComponent(title)}`)
      const d = (await res.json().catch(() => ({}))) as { candidates?: MlCategoryCandidate[]; error?: string }
      if (!res.ok) throw new Error(d?.error ?? 'No se pudo predecir la categoría.')
      const list = Array.isArray(d.candidates) ? d.candidates : []
      const choice = pickCategory(list, { importedMlCategoryId: link?.ml_category_id })
      setCandidates(list)
      setNeedsChoice(choice.needsChoice)
      setChosen(choice.categoryId ?? choice.suggestion ?? '')
      setStep('category')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo predecir la categoría.')
      setStep('idle')
    }
  }

  async function confirmPublish() {
    if (!chosen) {
      setError('Elige una categoría de Mercado Libre para publicar.')
      return
    }
    setStep('busy')
    setError(null)
    try {
      const res = await fetch('/api/sell/ml/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, categoryId: chosen }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d?.error ?? 'No se pudo publicar.')
      setLink({
        ml_item_id: d.ml_item_id,
        ml_status: d.status ?? 'active',
        permalink: d.permalink ?? null,
        ml_category_id: chosen,
        last_synced_at: new Date().toISOString(),
      })
      setOkMsg('¡Publicado en Mercado Libre!')
      setStep('done')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo publicar.')
      setStep('category')
    }
  }

  const busy = step === 'busy'
  const cardStyle: React.CSSProperties = {
    padding: 16,
    borderRadius: 'var(--r-lg)',
    border: '1.5px solid var(--border)',
    background: 'var(--bg-elevated)',
  }
  const primaryBtn: React.CSSProperties = {
    padding: '10px 16px', borderRadius: 'var(--r-md)', fontSize: 14, fontWeight: 600,
    background: 'var(--accent)', color: 'var(--fg-inverse)', border: 'none',
    cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
  }

  return (
    <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 12, marginTop: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 'var(--t-base)', fontWeight: 700, color: 'var(--fg)' }}>Mercado Libre</span>
        {view.linked && (
          <span style={{ fontSize: 12, fontWeight: 600, color: view.mlStatus === 'closed' ? 'var(--fg-muted)' : 'var(--success)' }}>
            · {view.mlStatus === 'closed' ? 'Cerrada' : 'Publicada'}
          </span>
        )}
      </div>

      {error && <div style={{ fontSize: 13, color: 'var(--danger)' }}>{error}</div>}
      {okMsg && <div style={{ fontSize: 13, color: 'var(--success)' }}>{okMsg}</div>}

      {view.linked && view.permalink && (
        <a href={view.permalink} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: 'var(--accent)' }}>
          Ver en Mercado Libre ↗
        </a>
      )}

      {/* Category step (publish a not-yet-linked product) */}
      {step === 'category' && !view.linked && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {needsChoice ? (
            <p style={{ fontSize: 13, color: 'var(--warning)', margin: 0 }}>
              No estamos seguros de la categoría. Elige la correcta antes de publicar.
            </p>
          ) : (
            <p style={{ fontSize: 13, color: 'var(--fg-muted)', margin: 0 }}>
              Categoría sugerida — puedes cambiarla antes de publicar.
            </p>
          )}
          {candidates.length > 0 ? (
            <select
              value={chosen}
              onChange={(e) => setChosen(e.target.value)}
              style={{ padding: '8px 10px', borderRadius: 'var(--r-md)', border: '1.5px solid var(--border)', fontSize: 14, background: 'var(--bg)' }}
            >
              <option value="">Selecciona una categoría…</option>
              {candidates.map((c) => (
                <option key={c.category_id} value={c.category_id}>
                  {c.category_name || c.category_id}{c.score ? ` (${Math.round(c.score * 100)}%)` : ''}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={chosen}
              onChange={(e) => setChosen(e.target.value.trim())}
              placeholder="ID de categoría de Mercado Libre (p. ej. MLM1234)"
              style={{ padding: '8px 10px', borderRadius: 'var(--r-md)', border: '1.5px solid var(--border)', fontSize: 14, background: 'var(--bg)' }}
            />
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={confirmPublish} disabled={busy} style={primaryBtn}>
              {busy ? 'Publicando…' : 'Publicar'}
            </button>
            <button
              type="button"
              onClick={() => { setStep('idle'); setError(null) }}
              disabled={busy}
              style={{ padding: '10px 16px', borderRadius: 'var(--r-md)', fontSize: 14, fontWeight: 600, background: 'transparent', border: '1.5px solid var(--border)', color: 'var(--fg)', cursor: 'pointer' }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Primary action */}
      {step !== 'category' && (
        <div>
          <button type="button" onClick={view.linked ? sync : startPublish} disabled={busy} style={primaryBtn}>
            {busy ? 'Procesando…' : view.actionLabel}
          </button>
        </div>
      )}
    </div>
  )
}
