'use client'

/**
 * Pickup-spot CRUD for the Envíos section — add / edit / remove physical
 * delivery points. Promoted verbatim out of the ShopSettings monolith so the
 * extracted Envíos section reuses the exact same component (no behavior change).
 * The parent owns the `spots` array (persisted in `settings.shipping.pickup_spots`).
 */

import { useState } from 'react'
import type { PickupSpot } from '@/lib/shop-settings/types'
import { Button } from '@/components/ui/Button'

export function PickupSpotManager({
  spots,
  onUpdate,
  schedulingLinks,
}: {
  spots: PickupSpot[]
  onUpdate: (spots: PickupSpot[]) => void
  schedulingLinks: Array<{ label: string; url: string }>
}) {
  const emptyForm = { name: '', address: '', hours: '', notes: '', scheduling_url: '' }
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)

  function resetForm() {
    setForm(emptyForm)
    setEditId(null)
    setShowForm(false)
  }

  function handleSubmit() {
    if (!form.name.trim() || !form.address.trim()) return
    if (editId) {
      onUpdate(spots.map(s => s.id === editId ? { ...form, id: editId } : s))
    } else {
      onUpdate([...spots, { ...form, id: Math.random().toString(36).slice(2) }])
    }
    resetForm()
  }

  function handleEdit(spot: PickupSpot) {
    setForm({
      name: spot.name,
      address: spot.address,
      hours: spot.hours ?? '',
      notes: spot.notes ?? '',
      scheduling_url: spot.scheduling_url ?? '',
    })
    setEditId(spot.id)
    setShowForm(true)
  }

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
          Puntos de entrega
        </p>
        {spots.length > 0 && (
          <span className="text-xs text-[var(--color-accent)] font-medium">
            {spots.length} punto{spots.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {spots.length > 0 && (
        <div className="space-y-2 mb-3">
          {spots.map(spot => (
            <div key={spot.id} className="flex items-start gap-2 bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-[var(--r-md)] px-3 py-2.5">
              <i className="iconoir-map-pin text-base mt-0.5 flex-shrink-0" aria-hidden />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{spot.name}</p>
                <p className="text-xs text-[var(--color-muted)]">{spot.address}</p>
                {spot.hours && <p className="text-xs text-[var(--color-muted)] mt-0.5"><i className="iconoir-clock" aria-hidden /> {spot.hours}</p>}
                {spot.notes && <p className="text-xs text-[var(--color-muted)] mt-0.5 italic">{spot.notes}</p>}
                {spot.scheduling_url && (
                  <p className="text-xs text-[var(--color-accent)] mt-0.5 truncate"><i className="iconoir-calendar" aria-hidden /> Cita en línea configurada</p>
                )}
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => handleEdit(spot)}
                  className="text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)] px-2 py-1 border border-[var(--color-border)] rounded-[var(--r-sm)] hover:bg-gray-50 transition-colors"
                >
                  Editar
                </button>
                <button
                  type="button"
                  onClick={() => onUpdate(spots.filter(s => s.id !== spot.id))}
                  className="text-xs text-[var(--danger)] hover:text-[var(--danger)] px-2 py-1 border border-[var(--danger)] rounded-[var(--r-sm)] hover:bg-[var(--danger-soft)] transition-colors"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm ? (
        <div className="border border-[var(--color-accent)] rounded-[var(--r-md)] p-3 space-y-2.5 bg-[var(--color-surface-alt)]">
          <p className="text-xs font-semibold text-[var(--color-foreground)]">
            {editId ? 'Editar punto' : 'Nuevo punto de entrega'}
          </p>
          <div>
            <label className="block text-xs font-medium mb-1">
              Nombre del punto <span className="text-[var(--danger)]">*</span>
            </label>
            <input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Casa matriz, Bodega norte, Local 12…"
              className="w-full border border-[var(--color-border)] rounded-[var(--r-sm)] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">
              Dirección <span className="text-[var(--danger)]">*</span>
            </label>
            <input
              value={form.address}
              onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
              placeholder="Av. Insurgentes 1234, Col. Del Valle, CDMX"
              className="w-full border border-[var(--color-border)] rounded-[var(--r-sm)] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium mb-1">Horario</label>
              <input
                value={form.hours}
                onChange={e => setForm(f => ({ ...f, hours: e.target.value }))}
                placeholder="Lun-Vie 9am-6pm"
                className="w-full border border-[var(--color-border)] rounded-[var(--r-sm)] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Notas para el comprador</label>
              <input
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Tocar el timbre del 3er piso"
                className="w-full border border-[var(--color-border)] rounded-[var(--r-sm)] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Enlace para agendar recogida (opcional)</label>
            <div className="flex gap-2">
              <input
                type="url"
                value={form.scheduling_url}
                onChange={e => setForm(f => ({ ...f, scheduling_url: e.target.value }))}
                placeholder="https://cal.com/tu-usuario/recogida"
                className="flex-1 border border-[var(--color-border)] rounded-[var(--r-sm)] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              />
              {schedulingLinks.length > 0 && (
                <select
                  onChange={e => { if (e.target.value) setForm(f => ({ ...f, scheduling_url: e.target.value })) }}
                  className="border border-[var(--color-border)] rounded-[var(--r-sm)] px-2 py-1.5 text-xs bg-[var(--bg-elevated)] focus:outline-none"
                  defaultValue=""
                >
                  <option value="">Mis enlaces ▾</option>
                  {schedulingLinks.map(l => (
                    <option key={l.url} value={l.url}>{l.label}</option>
                  ))}
                </select>
              )}
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button type="button" variant="secondary" size="sm" onClick={resetForm} className="flex-1">
              Cancelar
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={!form.name.trim() || !form.address.trim()}
              onClick={handleSubmit}
              className="flex-1"
            >
              {editId ? 'Guardar cambios' : 'Agregar punto'}
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="w-full border-2 border-dashed border-[var(--color-border)] rounded-[var(--r-md)] py-2.5 text-sm text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-colors"
        >
          + Agregar punto de entrega
        </button>
      )}

      <p className="text-xs text-[var(--color-muted)] mt-2 bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-[var(--r-md)] px-3 py-2 leading-relaxed">
        <i className="iconoir-light-bulb" aria-hidden /> Los compradores verán estos puntos al finalizar su compra. Próximamente podrán elegir el punto y agendar hora de recogida directamente desde el anuncio.
      </p>
    </div>
  )
}
