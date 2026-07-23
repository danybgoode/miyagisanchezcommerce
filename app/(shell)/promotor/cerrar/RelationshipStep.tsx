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
 *
 * `onRelationshipChange` reports the current relationship id up to
 * `PromoterCloseClient`, which links it to the shop the moment `SetupStep`
 * creates one (S1 cross-review A3 — a relationship must not stay orphaned
 * from the shop it precedes).
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
}

type Suggestion = { id: string; businessName: string }
type HistoryEntry = { id: string; businessName: string }

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

// A6: one promoter can capture MANY merchants in a session — a single
// "last id" key would let the second merchant silently overwrite the first
// on the next resume. History is a small per-promoter list; the active
// pointer is which one the form currently shows.
const HISTORY_CAP = 20
function historyKey(promoterCode: string): string {
  return `fm_relationships:${promoterCode}`
}
function activeKey(promoterCode: string): string {
  return `fm_relationship_active:${promoterCode}`
}
function readHistory(promoterCode: string): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(historyKey(promoterCode))
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
function upsertHistory(promoterCode: string, entry: HistoryEntry): HistoryEntry[] {
  const next = [entry, ...readHistory(promoterCode).filter((r) => r.id !== entry.id)].slice(0, HISTORY_CAP)
  try { localStorage.setItem(historyKey(promoterCode), JSON.stringify(next)) } catch { /* best-effort cache only */ }
  return next
}

export default function RelationshipStep({
  n,
  promoterCode,
  onRelationshipChange,
}: {
  n: number
  promoterCode: string
  /** Reports the current relationship id (or null) up to the parent — see
   *  file header. Called on every id change (load, save, new, switch). */
  onRelationshipChange?: (id: string | null) => void
}) {
  const [relationshipId, setRelationshipId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>([])

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
  const [consentMessage, setConsentMessage] = useState<string | null>(null)
  const [consentBusy, setConsentBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function setActive(id: string | null) {
    setRelationshipId(id)
    onRelationshipChange?.(id)
    try {
      if (id) localStorage.setItem(activeKey(promoterCode), id)
      else localStorage.removeItem(activeKey(promoterCode))
    } catch { /* best-effort cache only — the server record is the source of truth */ }
  }

  function populate(rel: Relationship) {
    setActive(rel.id)
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
    setHistory(upsertHistory(promoterCode, { id: rel.id, businessName: rel.businessName }))
  }

  /** A6 — blank the form for a NEW merchant. The previous record stays saved
   *  server-side and in the recent-records list; only the active pointer moves. */
  function startNew() {
    setActive(null)
    setBusinessName(''); setContactName(''); setPhone(''); setEmail(''); setWhatsapp('')
    setInstagramHandle(''); setEstado(''); setMunicipio(''); setCategory('')
    setPreferredChannel(''); setQualification('unknown'); setFitNote(''); setObjections('')
    setSavedAt(null); setSuggestions([]); setDedupe(null); setError(null); setConsentMessage(null)
  }

  // Resume the ACTIVE saved draft on mount. A 403 means the pointer is stale
  // (a different promoter's device, or the record no longer exists) — clear
  // it silently and start fresh rather than surfacing an error for something
  // the field promoter didn't do wrong.
  useEffect(() => {
    setHistory(readHistory(promoterCode))
    let active: string | null = null
    try { active = localStorage.getItem(activeKey(promoterCode)) } catch { /* no cache available */ }
    if (!active) {
      setLoaded(true)
      return
    }
    let cancelled = false
    fetch(`/api/promoter/relationship/${encodeURIComponent(active)}`)
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (cancelled) return
        if (ok && data.ok && data.relationship) {
          populate(data.relationship)
        } else {
          try { localStorage.removeItem(activeKey(promoterCode)) } catch { /* best-effort */ }
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
      if (res.status === 403) {
        // A9 — the dead-end the 409 "Usar registro existente" action can walk
        // into: the matched record belongs to a DIFFERENT promoter (or an
        // expired grant). Say so plainly instead of a generic failure message.
        setError('Ese registro pertenece a otro promotor — no puedes cargarlo aquí. Puedes seguir con tu propio registro nuevo.')
        return
      }
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
          // A14: send every optional field's CURRENT value explicitly (even
          // blank) rather than `value || undefined` — omitting a field the
          // promoter just cleared would make the server treat it as "not
          // touched" and silently keep the OLD stored value on reload.
          contactName,
          phone,
          email,
          whatsapp,
          instagramHandle,
          estado,
          municipio,
          category,
          preferredChannel,
          qualification,
          fitNote,
          objections,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 409 && data.relationshipId) {
        setDedupe({ relationshipId: data.relationshipId, matchReason: data.matchReason ?? 'desconocido' })
        return
      }
      if (res.status === 400 && data.error) { setError(data.error); return }
      if (!res.ok || !data.ok) { setError(data.error ?? 'No se pudo guardar el registro.'); return }
      setActive(data.relationship.id)
      setHistory(upsertHistory(promoterCode, { id: data.relationship.id, businessName: data.relationship.businessName }))
      setSuggestions(Array.isArray(data.suggestions) ? data.suggestions : [])
      setSavedAt(new Date())
    } catch { setError('Error de red. Intenta de nuevo.') }
    finally { setBusy(false) }
  }

  async function registerConsent() {
    if (!relationshipId) return
    setConsentBusy(true); setConsentMessage(null)
    try {
      // A7: no previewId is sent — the server resolves it from THIS
      // relationship's own linked shop (`getPreviewByShop`), so the button
      // works the instant a preview exists, without the UI needing to learn
      // a raw preview id from a sibling step.
      const res = await fetch(`/api/promoter/relationship/${encodeURIComponent(relationshipId)}/consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
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
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-semibold">
          <span className="text-[var(--color-muted)] mr-2">{n}.</span>Datos del comercio
        </h2>
        {(relationshipId || history.length > 0) && (
          <button type="button" onClick={startNew} disabled={busy}
            className="text-xs underline text-[var(--color-muted)] disabled:opacity-50 whitespace-nowrap">
            + Nuevo registro
          </button>
        )}
      </div>
      <p className="text-sm text-[var(--color-muted)]">
        Captura lo que sepas del comercio ahora mismo — solo el nombre es obligatorio. Puedes guardar y
        continuar más tarde, incluso sin conexión estable.
      </p>

      {history.length > 0 && (
        <div className="flex flex-wrap gap-1.5 text-xs">
          {history.map((h) => (
            <button key={h.id} type="button" onClick={() => loadExisting(h.id)} disabled={busy}
              className={`rounded-full border px-2.5 py-1 disabled:opacity-50 ${h.id === relationshipId ? 'border-[var(--color-accent)] font-medium' : 'border-[var(--color-border)] text-[var(--color-muted)]'}`}>
              {h.businessName}
            </button>
          ))}
        </div>
      )}

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
              <button type="button" onClick={registerConsent} disabled={consentBusy}
                className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-medium disabled:opacity-50">
                {consentBusy ? 'Verificando…' : 'Registrar permiso del comerciante'}
              </button>
              {consentMessage && <p className="text-sm">{consentMessage}</p>}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
