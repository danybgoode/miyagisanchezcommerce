'use client'

/**
 * Citas y reservas — booking links + Cal.com connect. Extracted verbatim from the
 * monolith's `#citas` section. Behavior-preserving:
 *   - scheduling links persist as `settings.scheduling.links` via useSettingsSave()
 *   - Cal.com connect/disconnect calls the separate `/api/sell/shop/calcom`
 *     POST/DELETE endpoint directly (unchanged), like the monolith.
 */

import { useState } from 'react'
import { useSettingsSave } from '../_components/useSettingsSave'
import { Toast } from '@/components/feedback/Toast'
import { SectionSaveBar } from '../_components/SectionSaveBar'
import { CopyPromptButton } from '../_components/CopyPromptButton'
import { detectSchedulingService } from '@/lib/shop-settings/helpers'

type SchedulingLink = { label: string; url: string }

export interface CitasInitial {
  scheduling_links: SchedulingLink[]
  calcom_connected: boolean
  calcom_username: string | null
  calcom_event_type_title: string | null
  calcom_booking_url: string | null
}

export default function Citas({ initial }: { initial: CitasInitial }) {
  const { save, saving, toast, showToast, dismissToast, isDirty, markDirty } = useSettingsSave()
  const mark = markDirty

  const [schedulingLinks, setSchedulingLinks] = useState<SchedulingLink[]>(initial.scheduling_links)
  const [newLinkUrl, setNewLinkUrl]           = useState('')
  const [newLinkLabel, setNewLinkLabel]       = useState('')

  // Cal.com scheduling
  const [calcomConnected, setCalcomConnected]       = useState(initial.calcom_connected ?? false)
  const [calcomUsername, setCalcomUsername]         = useState(initial.calcom_username ?? '')
  const [calcomEventTitle, setCalcomEventTitle]     = useState(initial.calcom_event_type_title ?? '')
  const [calcomBookingUrl, setCalcomBookingUrl]     = useState(initial.calcom_booking_url ?? '')
  const [calcomApiKey, setCalcomApiKey]             = useState('')
  const [calcomConnecting, setCalcomConnecting]     = useState(false)
  const [calcomEventTypes, setCalcomEventTypes]     = useState<Array<{ id: number; slug: string; title: string }>>([])
  const [calcomPickEventTypeId, setCalcomPickEventTypeId] = useState<number | null>(null)
  const [calcomPickStep, setCalcomPickStep]         = useState(false)
  const [showApiKeyForm, setShowApiKeyForm]         = useState(false)

  function addSchedulingLink() {
    const url = newLinkUrl.trim()
    if (!url) return
    if (!/^https?:\/\//i.test(url)) { showToast('URL inválida — debe comenzar con https://', 'error'); return }
    const label = newLinkLabel.trim() || detectSchedulingService(url)
    setSchedulingLinks(prev => [...prev, { label, url }])
    setNewLinkUrl('')
    setNewLinkLabel('')
    mark()
  }

  async function handleCalcomConnect(eventTypeId?: number) {
    if (!calcomApiKey.trim() && !eventTypeId) { showToast('Pega tu API key de Cal.com primero.', 'error'); return }
    setCalcomConnecting(true)
    try {
      const body: Record<string, unknown> = {}
      if (calcomApiKey.trim()) body.api_key = calcomApiKey.trim()
      if (eventTypeId) body.event_type_id = eventTypeId
      const res  = await fetch('/api/sell/shop/calcom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json() as {
        step?: string
        user?: { username: string }
        eventTypes?: Array<{ id: number; slug: string; title: string }>
        username?: string
        eventType?: { id: number; title: string }
        bookingUrl?: string
        error?: string
      }
      if (!res.ok) { showToast(data.error ?? 'Error al conectar.', 'error'); return }

      if (data.step === 'pick_event_type' && data.eventTypes) {
        setCalcomEventTypes(data.eventTypes)
        setCalcomPickEventTypeId(data.eventTypes[0]?.id ?? null)
        setCalcomPickStep(true)
        return
      }
      if (data.step === 'connected') {
        setCalcomConnected(true)
        setCalcomUsername(data.username ?? '')
        setCalcomEventTitle(data.eventType?.title ?? '')
        setCalcomBookingUrl(data.bookingUrl ?? '')
        setCalcomApiKey('')
        setCalcomPickStep(false)
        showToast('Cal.com conectado correctamente.', 'success')
      }
    } catch { showToast('Error de red al conectar Cal.com.', 'error') }
    finally { setCalcomConnecting(false) }
  }

  async function handleCalcomDisconnect() {
    try {
      await fetch('/api/sell/shop/calcom', { method: 'DELETE' })
      setCalcomConnected(false)
      setCalcomUsername('')
      setCalcomEventTitle('')
      setCalcomBookingUrl('')
      setCalcomApiKey('')
      setCalcomPickStep(false)
      showToast('Cal.com desconectado.', 'success')
    } catch { showToast('Error al desconectar.', 'error') }
  }

  async function handleSave() {
    await save({ settings: { scheduling: { links: schedulingLinks } } })
  }

  return (
    <div>
      <section id="citas" className="border border-[var(--color-border)] rounded-xl p-5 mb-5">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xl">📅</span>
          <h2 className="font-semibold text-sm">Citas y Reservas</h2>
        </div>
        <p className="text-xs text-[var(--color-muted)] mb-2">
          Para servicios, rentas, creadores y cualquier negocio que trabaje por cita.
        </p>
        <div className="flex flex-wrap gap-1.5 mb-5">
          {['Consultas', 'Pruebas de manejo', 'Visitas a propiedades', 'Sesiones de fotos', 'Encuentros con fans', 'Clases', 'Rentas por hora'].map(tag => (
            <span key={tag} className="text-[11px] bg-[var(--color-surface-alt)] border border-[var(--color-border)] text-[var(--color-muted)] px-2 py-0.5 rounded-full">
              {tag}
            </span>
          ))}
        </div>

        {/* Tier 1: booking links */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
              🔗 Mis enlaces de reservas
            </p>
            {schedulingLinks.length > 0 && (
              <span className="text-xs text-green-700 font-medium bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
                {schedulingLinks.length} enlace{schedulingLinks.length > 1 ? 's' : ''} guardado{schedulingLinks.length > 1 ? 's' : ''}
              </span>
            )}
          </div>

          {schedulingLinks.length > 0 && (
            <div className="space-y-1.5 mb-3">
              {schedulingLinks.map((link, i) => (
                <div key={i} className="flex items-center gap-2 bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-lg px-3 py-2">
                  <span className="text-base">
                    {link.url.includes('cal.com') ? '📅' : link.url.includes('calendly.com') ? '📆' : '🔗'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{link.label}</p>
                    <p className="text-xs text-[var(--color-muted)] truncate">{link.url}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setSchedulingLinks(prev => prev.filter((_, j) => j !== i)); mark() }}
                    className="text-xs text-red-500 hover:text-red-700 flex-shrink-0 px-1"
                    aria-label="Eliminar enlace"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2">
            <input
              type="url"
              value={newLinkUrl}
              onChange={e => setNewLinkUrl(e.target.value)}
              placeholder="https://cal.com/tu-usuario/consulta  ó  https://calendly.com/tu-usuario"
              className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSchedulingLink() } }}
            />
            <div className="flex gap-2">
              <input
                type="text"
                value={newLinkLabel}
                onChange={e => setNewLinkLabel(e.target.value)}
                placeholder="Etiqueta (opcional) — se detecta automáticamente"
                className="flex-1 border border-[var(--color-border)] rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              />
              <button
                type="button"
                onClick={addSchedulingLink}
                disabled={!newLinkUrl.trim()}
                className="bg-[var(--color-accent)] text-white px-4 py-2 rounded text-sm font-semibold disabled:opacity-40 hover:bg-[var(--color-accent-hover)] transition-colors whitespace-nowrap"
              >
                + Agregar
              </button>
            </div>
          </div>

          <p className="text-xs text-[var(--color-muted)] mt-2">
            Funciona con Cal.com, Calendly, Acuity, TidyCal, Google Calendar y cualquier enlace de reservas.
          </p>

          {schedulingLinks.length === 0 && !calcomConnected && (
            <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-xs text-amber-700 leading-relaxed">
              <strong>¿No tienes cuenta de agendamiento?</strong> Cal.com es gratuito, tarda 3 minutos y te da una página profesional.{' '}
              <a href="https://cal.com/signup" target="_blank" rel="noopener noreferrer" className="text-amber-800 underline hover:text-amber-900">
                Crear cuenta gratis ↗
              </a>
            </div>
          )}
        </div>

        {/* Tier 2: Cal.com API */}
        <div className="border-t border-[var(--color-border)] pt-4">
          <div className="flex items-start justify-between mb-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                  ✨ Cal.com — Agentes de IA
                </p>
                <CopyPromptButton prompt="¿Es seguro compartir mi API key de Cal.com con una plataforma de terceros? Verifica con la documentación oficial de Cal.com: https://cal.com/docs/enterprise-features/api/api-keys — ¿Qué acceso otorga una API key? ¿Puede la plataforma modificar mi calendario o crear citas sin mi permiso? ¿Cómo puedo revocar el acceso si es necesario?" />
              </div>
              <p className="text-xs text-[var(--color-muted)] mt-0.5">
                {calcomConnected
                  ? 'Los agentes de IA pueden verificar disponibilidad y agendar automáticamente.'
                  : 'Conecta tu API key para que agentes de IA agenden citas en tu nombre.'}
              </p>
            </div>
            {!calcomConnected && !calcomPickStep && (
              <button
                type="button"
                onClick={() => setShowApiKeyForm(v => !v)}
                className="text-xs text-[var(--color-accent)] hover:underline flex-shrink-0 ml-3"
              >
                {showApiKeyForm ? 'Ocultar' : 'Conectar API →'}
              </button>
            )}
          </div>

          {calcomConnected ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                <span className="text-lg">✓</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-green-800">Conectado como @{calcomUsername}</p>
                  <p className="text-xs text-green-600 mt-0.5 truncate">
                    Evento: {calcomEventTitle} ·{' '}
                    <a href={calcomBookingUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                      Ver página ↗
                    </a>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCalcomDisconnect}
                  className="text-xs text-red-600 hover:text-red-700 border border-red-200 rounded px-2.5 py-1 hover:bg-red-50 transition-colors flex-shrink-0"
                >
                  Desconectar
                </button>
              </div>
            </div>
          ) : calcomPickStep ? (
            <div className="space-y-3">
              <p className="text-sm font-medium">Selecciona qué tipo de evento usar:</p>
              <div className="space-y-2">
                {calcomEventTypes.map(et => (
                  <label key={et.id} className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                    calcomPickEventTypeId === et.id ? 'border-[var(--color-accent)] bg-green-50' : 'border-[var(--color-border)] hover:border-[var(--color-accent)]'
                  }`}>
                    <input
                      type="radio"
                      name="cal_event_type"
                      checked={calcomPickEventTypeId === et.id}
                      onChange={() => setCalcomPickEventTypeId(et.id)}
                      className="accent-[var(--color-accent)]"
                    />
                    <div>
                      <p className="text-sm font-medium">{et.title}</p>
                      <p className="text-xs text-[var(--color-muted)]">/{et.slug}</p>
                    </div>
                  </label>
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setCalcomPickStep(false); setCalcomEventTypes([]) }}
                  className="flex-1 border border-[var(--color-border)] rounded py-2 text-sm hover:bg-gray-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={!calcomPickEventTypeId || calcomConnecting}
                  onClick={() => calcomPickEventTypeId && handleCalcomConnect(calcomPickEventTypeId)}
                  className="flex-1 bg-[var(--color-accent)] text-white rounded py-2 text-sm font-semibold disabled:opacity-50"
                >
                  {calcomConnecting ? 'Conectando…' : 'Usar este evento'}
                </button>
              </div>
            </div>
          ) : showApiKeyForm ? (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium mb-1.5">
                  API Key de Cal.com
                  <a
                    href="https://app.cal.com/settings/developer/api-keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-2 text-[var(--color-accent)] font-normal no-underline hover:underline"
                  >
                    Obtener API key ↗
                  </a>
                </label>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={calcomApiKey}
                    onChange={e => setCalcomApiKey(e.target.value)}
                    placeholder="cal_live_xxxxxxxxxxxxxxxxxxxx"
                    className="flex-1 border border-[var(--color-border)] rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                  />
                  <button
                    type="button"
                    disabled={!calcomApiKey.trim() || calcomConnecting}
                    onClick={() => handleCalcomConnect()}
                    className="bg-[var(--color-accent)] text-white px-4 py-2 rounded text-sm font-semibold disabled:opacity-40 hover:bg-[var(--color-accent-hover)] transition-colors whitespace-nowrap"
                  >
                    {calcomConnecting ? 'Verificando…' : 'Conectar'}
                  </button>
                </div>
              </div>
              <div className="bg-[var(--color-background)] border border-[var(--color-border)] rounded-lg p-3 text-xs text-[var(--color-muted)] space-y-1">
                <p className="font-medium text-[var(--color-foreground)]">¿Cómo obtener tu API key?</p>
                <ol className="list-decimal list-inside space-y-0.5 ml-1">
                  <li>Ve a <a href="https://app.cal.com/settings/developer/api-keys" target="_blank" rel="noopener noreferrer" className="text-[var(--color-accent)] hover:underline no-underline">cal.com/settings/developer/api-keys</a></li>
                  <li>Crea una nueva API key (nombre: &ldquo;Miyagi Sánchez&rdquo;)</li>
                  <li>Copia y pega la key aquí arriba</li>
                </ol>
              </div>
            </div>
          ) : (
            schedulingLinks.length > 0 && (
              <p className="text-xs text-[var(--color-muted)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-lg px-3 py-2">
                💡 <strong>¿Quieres más poder?</strong> Conecta tu API key de Cal.com para que los agentes de IA verifiquen disponibilidad y agenden citas automáticamente.{' '}
                <button type="button" onClick={() => setShowApiKeyForm(true)} className="text-[var(--color-accent)] hover:underline">
                  Conectar →
                </button>
              </p>
            )
          )}
        </div>
      </section>

      <SectionSaveBar saving={saving} isDirty={isDirty} onSave={handleSave} />

      {toast && <Toast toast={toast} onDismiss={dismissToast} />}
    </div>
  )
}
