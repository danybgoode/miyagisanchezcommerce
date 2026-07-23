'use client'

import { useEffect, useState } from 'react'
import { ESTADO_NAMES } from '@/lib/mx-locations'

/**
 * Founding merchant activation operations · Sprint 1 — the field-intake step
 * (Story 1.2/1.3). Only rendered when `promoter.activation_crm_enabled` is ON,
 * and placed FIRST in the close workspace — the merchant relationship record
 * precedes the shop (README D1: it must be able to exist before any shop
 * does). Mobile-first: one required field (business name), explicit save
 * state, resume by id from `localStorage` so a dropped signal or a reload
 * mid-conversation never loses the record.
 *
 * Thin screen over POST/GET /api/promoter/relationship[/id] and
 * POST /api/promoter/relationship/[id]/consent.
 */

type Relationship = {
  id: string
  businessName: string
  contactName: string | null
  phone: string | null
  email: string | null
  whatsapp: string | null
  instagramHandle: string | null
  estado: string | null
  municipio: string | null
  category: string | null
  preferredChannel: string | null
  qualification: string
  fitNote: string | null
  objections: string | null
  cohort: string | null
  source: string | null
  previewId: string | null
}

type Suggestion = { id: string; businessName: string }

const PREFERRED_CHANNEL_LABEL: Record<string, string> = {
  whatsapp: 'WhatsApp',
  phone: 'Teléfono',
  email: 'Correo',
  instagram: 'Instagram',
  in_person: 'En persona',
}

const QUALIFICATION_LABEL: Record<string, string> = {
  unknown: 'Sin calificar',
  strong: 'Fuerte',
  medium: 'Media',
  weak: 'Débil',
  disqualified: 'Descartado',
}

function storageKey(promoterCode: string): string {
  return `fm_relationship_id:${promoterCode}`
}

export default function RelationshipStep({ n, promoterCode }: { n: number; promoterCode: string }) {
  const [relationshipId, setRelationshipId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const [businessName, setBusinessName] = useState('')
  const [contactName, setContactName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [instagramHandle, setInstagramHandle] = useState('')
  const [estado, setEstado] = useState('')
  const [municipio, setMunicipio] = useState('')
  const [category, setCategory] = useState('')
  const [preferredChannel, setPreferredChannel] = useState('')
  const [qualification, setQualification] = useState('unknown')
  const [fitNote, setFitNote] = useState('')
  const [objections, setObjections] = useState('')

  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [dedupe, setDedupe] = useState<{ relationshipId: string; matchReason: string } | null>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [consentMessage, setConsentMessage] = useState<string | null>(null)
  const [consentBusy, setConsentBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function populate(rel: Relationship) {
    setRelationshipId(rel.id)
    setBusinessName(rel.businessName)
    setContactName(rel.contactName ?? '')
    setPhone(rel.phone ?? '')
    setEmail(rel.email ?? '')
    setWhatsapp(rel.whatsapp ?? '')
    setInstagramHandle(rel.instagramHandle ?? '')
    setEstado(rel.estado ?? '')
    setMunicipio(rel.municipio ?? '')
    setCategory(rel.category ?? '')
    setPreferredChannel(rel.preferredChannel ?? '')
    setQualification(rel.qualification ?? 'unknown')
    setFitNote(rel.fitNote ?? '')
    setObjections(rel.objections ?? '')
    setPreviewId(rel.previewId)
    localStorage.setItem(storageKey(promoterCode), rel.id)
  }

  // Resume a saved draft on mount. A 403 means the id is stale (a different
  // promoter's device, or the record no longer exists) — clear it silently
  // and start fresh rather than surfacing an error for something the field
  // promoter didn't do wrong.
  useEffect(() => {
    const saved = localStorage.getItem(storageKey(promoterCode))
    if (!saved) {
      setLoaded(true)
      return
    }
    let cancelled = false
    fetch(`/api/promoter/relationship/${encodeURIComponent(saved)}`)
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (cancelled) return
        if (ok && data.ok && data.relationship) {
          populate(data.relationship)
        } else {
          localStorage.removeItem(storageKey(promoterCode))
        }
      })
      .catch(() => { /* best-effort resume — a fresh capture is still possible */ })
      .finally(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promoterCode])

  async function loadExisting(id: string) {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/promoter/relationship/${encodeURIComponent(id)}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) { setError('No se pudo cargar el registro existente.'); return }
      populate(data.relationship)
      setDedupe(null)
      setSuggestions([])
    } catch { setError('Error de red. Intenta de nuevo.') }
    finally { setBusy(false) }
  }

  async function save(confirmNew = false) {
    if (businessName.trim().length < 2) {
      setError('El nombre del negocio es obligatorio.')
      return
    }
    setBusy(true); setError(null); setDedupe(null)
    try {
      const res = await fetch('/api/promoter/relationship', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          relationshipId: relationshipId ?? undefined,
          confirmNew: confirmNew || undefined,
          businessName,
          contactName: contactName || undefined,
          phone: phone || undefined,
          email: email || undefined,
          whatsapp: whatsapp || undefined,
          instagramHandle: instagramHandle || undefined,
          estado: estado || undefined,
          municipio: municipio || undefined,
          category: category || undefined,
          preferredChannel: preferredChannel || undefined,
          qualification,
          fitNote: fitNote || undefined,
          objections: objections || undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 409 && data.relationshipId) {
        setDedupe({ relationshipId: data.relationshipId, matchReason: data.matchReason ?? 'desconocido' })
        return
      }
      if (!res.ok || !data.ok) { setError(data.error ?? 'No se pudo guardar el registro.'); return }
      setRelationshipId(data.relationship.id)
      setPreviewId(data.relationship.previewId)
      localStorage.setItem(storageKey(promoterCode), data.relationship.id)
      setSuggestions(Array.isArray(data.suggestions) ? data.suggestions : [])
      setSavedAt(new Date())
    } catch { setError('Error de red. Intenta de nuevo.') }
    finally { setBusy(false) }
  }

  async function registerConsent() {
    if (!relationshipId) return
    setConsentBusy(true); setConsentMessage(null)
    try {
      const res = await fetch(`/api/promoter/relationship/${encodeURIComponent(relationshipId)}/consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(previewId ? { previewId } : {}),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) {
        setConsentMessage(data.error ?? 'No se pudo registrar el permiso.')
        return
      }
      setConsentMessage('Permiso registrado — el comerciante aprobó la vista previa vigente.')
    } catch { setConsentMessage('Error de red. Intenta de nuevo.') }
    finally { setConsentBusy(false) }
  }

  const MX_INPUT = 'w-full rounded-lg border border-[var(--color-border)] px-3 py-2'

  return (
    <section className="rounded-lg border border-[var(--color-border)] p-4 space-y-3">
      <h2 className="font-semibold">
        <span className="text-[var(--color-muted)] mr-2">{n}.</span>Datos del comercio
      </h2>
      <p className="text-sm text-[var(--color-muted)]">
        Captura lo que sepas del comercio ahora mismo — solo el nombre es obligatorio. Puedes guardar y
        continuar más tarde, incluso sin conexión estable.
      </p>

      {!loaded ? (
        <p className="text-sm text-[var(--color-muted)]">Cargando…</p>
      ) : (
        <div className="space-y-3">
          <input
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder="Nombre del negocio *"
            className={MX_INPUT}
          />
          <input value={contactName} onChange={(e) => setContactName(e.target.value)}
            placeholder="Nombre de contacto (opcional)" className={MX_INPUT} />

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input value={phone} onChange={(e) => setPhone(e.target.value)}
              inputMode="tel" placeholder="Teléfono" className={MX_INPUT} />
            <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)}
              inputMode="tel" placeholder="WhatsApp (si es distinto)" className={MX_INPUT} />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input value={email} onChange={(e) => setEmail(e.target.value)}
              type="email" placeholder="Correo" className={MX_INPUT} />
            <input value={instagramHandle} onChange={(e) => setInstagramHandle(e.target.value)}
              placeholder="Instagram (@usuario)" className={MX_INPUT} />
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <select value={estado} onChange={(e) => setEstado(e.target.value)} aria-label="Estado" className={MX_INPUT}>
              <option value="">Estado (opcional)…</option>
              {ESTADO_NAMES.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
            <input value={municipio} onChange={(e) => setMunicipio(e.target.value)}
              placeholder="Municipio / alcaldía" className={MX_INPUT} />
          </div>

          <input value={category} onChange={(e) => setCategory(e.target.value)}
            placeholder="Categoría del negocio" className={MX_INPUT} />

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-[var(--color-muted)]">Canal preferido</span>
              <select value={preferredChannel} onChange={(e) => setPreferredChannel(e.target.value)}
                aria-label="Canal preferido" className={`mt-1 ${MX_INPUT}`}>
                <option value="">Sin especificar…</option>
                {Object.entries(PREFERRED_CHANNEL_LABEL).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-[var(--color-muted)]">Calificación</span>
              <select value={qualification} onChange={(e) => setQualification(e.target.value)}
                aria-label="Calificación" className={`mt-1 ${MX_INPUT}`}>
                {Object.entries(QUALIFICATION_LABEL).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
            </label>
          </div>

          <textarea value={fitNote} onChange={(e) => setFitNote(e.target.value)}
            placeholder="Notas de encaje (opcional)" rows={2} className={MX_INPUT} />
          <textarea value={objections} onChange={(e) => setObjections(e.target.value)}
            placeholder="Objeciones (opcional)" rows={2} className={MX_INPUT} />

          {dedupe && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 space-y-2">
              <p>
                Ya existe un registro que coincide por <strong>{dedupe.matchReason}</strong>.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => loadExisting(dedupe.relationshipId)} disabled={busy}
                  className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm font-medium disabled:opacity-50">
                  Usar registro existente
                </button>
                <button type="button" onClick={() => save(true)} disabled={busy}
                  className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm font-medium disabled:opacity-50">
                  Crear de todas formas
                </button>
              </div>
            </div>
          )}

          {suggestions.length > 0 && (
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm space-y-1">
              <p className="font-medium">Nombres parecidos ya registrados (revisa antes de continuar):</p>
              <ul className="list-disc pl-5">
                {suggestions.map((s) => (
                  <li key={s.id}>
                    {s.businessName}{' '}
                    <button type="button" onClick={() => loadExisting(s.id)} className="underline text-[var(--color-muted)]">
                      usar este
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && <p className="text-sm text-[color:var(--danger)]">{error}</p>}

          <div className="flex items-center gap-3">
            <button onClick={() => save(false)} disabled={busy}
              className="rounded-lg bg-[var(--color-accent)] text-[var(--fg-inverse)] px-4 py-2 font-medium disabled:opacity-50">
              {busy ? 'Guardando…' : relationshipId ? 'Guardar cambios' : 'Guardar registro'}
            </button>
            {savedAt && (
              <span className="text-sm text-[color:var(--success)]">
                <i className="iconoir-check-circle" aria-hidden /> Guardado {savedAt.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>

          {relationshipId && (
            <div className="border-t border-[var(--color-border)] pt-3 space-y-2">
              <button type="button" onClick={registerConsent} disabled={consentBusy || !previewId}
                className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-medium disabled:opacity-50">
                {consentBusy ? 'Verificando…' : 'Registrar permiso del comerciante'}
              </button>
              {!previewId && (
                <p className="text-xs text-[var(--color-muted)]">
                  Aún no hay una vista previa vinculada — genera una en el paso de vista previa antes de registrar el permiso.
                </p>
              )}
              {consentMessage && <p className="text-sm">{consentMessage}</p>}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
