'use client'

import { useState, useRef, useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CATEGORIES, CITIES_BY_STATE } from '@/lib/types'
import { ESTADOS } from '@/lib/mx-locations'
import { buildQuery, resultCountLabel } from '@/lib/listing-query'
import type { SearchParams, SortOption } from '@/lib/types'
import type { CarFacets } from '@/lib/car-facets'

type SearchBarProps = {
  initialQ?: string
  initialCategory?: string
  initialState?: string
  params: SearchParams
  initialTotal?: number
  /** Derived autos facet rail (cars-vertical S1.1); null ⇒ plain free-text panel. */
  carFacets?: CarFacets | null
}

const SORT_OPTIONS: { value: SortOption | ''; label: string }[] = [
  { value: 'reciente', label: 'Más recientes' },
  { value: 'precio_asc', label: 'Menor precio' },
  { value: 'precio_desc', label: 'Mayor precio' },
  { value: 'popular', label: 'Más vistos' },
]

// Autos-only sorts (cars-vertical S1.2) — appended to the sort menu only when the
// autos category is active (año newest/oldest, marca A–Z; tratocar parity).
const AUTO_SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'year_desc', label: 'Más nuevos (año)' },
  { value: 'year_asc', label: 'Más antiguos (año)' },
  { value: 'marca', label: 'Marca (A–Z)' },
]

const CONDITIONS = [
  { value: '', label: 'Cualquier condición' },
  { value: 'new', label: 'Nuevo' },
  { value: 'like_new', label: 'Como nuevo' },
  { value: 'good', label: 'Buen estado' },
  { value: 'fair', label: 'Aceptable' },
  { value: 'parts', label: 'Para piezas' },
]

const PROPERTY_TYPES = [
  { value: 'departamento', label: 'Departamentos' },
  { value: 'casa', label: 'Casas' },
  { value: 'terreno', label: 'Terrenos' },
  { value: 'oficina', label: 'Oficinas/locales' },
  { value: 'bodega', label: 'Bodegas' },
  { value: 'otro', label: 'Otros' },
]

function BuyerShellPortal({ open, children }: { open: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  // The trigger only exists below `sm`; retaining the normal in-flow form until it
  // opens preserves the desktop card while escaping PlatformShell's isolation on mobile.
  return open && mounted ? createPortal(children, document.body) : children
}

export default function SearchBar({ initialQ, initialCategory, initialState, params, initialTotal, carFacets }: SearchBarProps) {
  const [category, setCategory] = useState(initialCategory ?? '')
  const [selectedState, setSelectedState] = useState(initialState ?? '')
  const [selectedPropertyTypes, setSelectedPropertyTypes] = useState<string[]>(
    params.property_type ? params.property_type.split(',').filter(Boolean) : []
  )
  // Mobile bottom-sheet open/closed (sm+ keeps the inline form, no sheet).
  const [open, setOpen] = useState(false)
  // Live "Ver X resultados" count — seeded from the SSR total (zero fetch on
  // open), then re-derived (debounced) as staged filters change.
  const [count, setCount] = useState<number | null>(initialTotal ?? null)
  const formRef = useRef<HTMLFormElement>(null)
  const countTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // A mobile-open form is portalled to <body>. If the viewport crosses into
  // desktop, close first so it returns to its inline layout position and the
  // open-state effect below restores body scrolling.
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 640px)')
    const closeOnDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) setOpen(false)
    }
    desktop.addEventListener('change', closeOnDesktop)
    return () => desktop.removeEventListener('change', closeOnDesktop)
  }, [])

  // Debounced recount: read the form's current values (controlled + uncontrolled),
  // merge the applied listing_type from the instant rail (not part of this form),
  // and ask the count endpoint how many results the staged filters would yield.
  function scheduleRecount() {
    if (countTimer.current) clearTimeout(countTimer.current)
    countTimer.current = setTimeout(async () => {
      const f = formRef.current
      if (!f) return
      const obj: Record<string, string> = {}
      new FormData(f).forEach((v, k) => { if (typeof v === 'string' && v) obj[k] = v })
      if (params.listing_type) obj.listing_type = params.listing_type
      try {
        const res = await fetch(`/api/listings/count${buildQuery(obj as SearchParams)}`)
        if (res.ok) setCount((await res.json()).total ?? 0)
      } catch { /* keep the last known count */ }
    }, 300)
  }

  useEffect(() => () => { if (countTimer.current) clearTimeout(countTimer.current) }, [])

  function togglePropertyType(value: string) {
    setSelectedPropertyTypes(prev =>
      prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]
    )
  }

  // Close the sheet on Escape and lock body scroll while it's open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open])

  // "Limpiar" — clear every staged filter back to empty/default without
  // applying (the buyer still taps the apply button to commit). Resets both the
  // controlled selects and the uncontrolled inputs inside the form.
  function clearFilters() {
    setCategory('')
    setSelectedState('')
    setSelectedPropertyTypes([])
    const f = formRef.current
    if (!f) return
    f.querySelectorAll('input').forEach(el => {
      if (el.type === 'submit' || el.type === 'button') return
      if (el.type === 'checkbox' || el.type === 'radio') el.checked = false
      else el.value = ''
    })
    f.querySelectorAll('select').forEach(el => {
      el.value = el.name === 'sort' ? 'reciente' : ''
    })
    scheduleRecount()
  }

  const inputClass = 'border border-white/30 bg-white/20 text-white placeholder-white/70 rounded-[var(--r-sm)] px-2 py-1.5 text-sm focus:outline-none focus:border-white focus:bg-white/30 w-full'
  const labelClass = 'text-white/80 text-xs mb-0.5 block'
  const selectClass = 'border border-white/30 bg-white/20 text-white rounded-[var(--r-sm)] px-2 py-1.5 text-sm focus:outline-none focus:border-white w-full [&>option]:text-[var(--color-text)] [&>option]:bg-[var(--fg-inverse)]'

  return (
    <>
      {/* Mobile-only sticky trigger — opens the filter sheet. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="sm:hidden sticky top-2 z-30 w-full flex items-center justify-center gap-2 bg-[var(--claim-accent)] text-white font-semibold text-sm rounded-[var(--r-md)] px-4 py-2.5 mb-4 shadow-sm"
      >
        <i className="iconoir-filter-list" /> Filtrar y ordenar
      </button>

      {/* Mobile-only backdrop behind the sheet. */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          className="sm:hidden fixed inset-0 z-40 bg-black/40"
          aria-hidden="true"
        />
      )}

      <BuyerShellPortal open={open}>
      <form
        ref={formRef}
        method="GET"
        action="/l"
        onChange={scheduleRecount}
        className={[
          'bg-[var(--claim-accent)]',
          // Mobile: bottom-sheet, slides up when open.
          'fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-[var(--r-xl)] p-4 shadow-2xl',
          'transition-transform duration-300',
          open ? 'translate-y-0' : 'translate-y-full',
          // sm+: revert to the inline card (unchanged from S1).
          'sm:static sm:translate-y-0 sm:max-h-none sm:overflow-visible sm:rounded-[var(--r-lg)] sm:shadow-none sm:z-auto sm:transition-none sm:mb-6',
        ].join(' ')}
      >
        {/* Sheet header (mobile only). */}
        <div className="sm:hidden flex items-center justify-between mb-3">
          <span className="text-white font-semibold text-sm">Filtros</span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Cerrar filtros"
            className="text-white/80 hover:text-white text-lg leading-none px-1"
          >
            <i className="iconoir-xmark" />
          </button>
        </div>

      {/* Hidden property_type input for checkboxes */}
      {selectedPropertyTypes.length > 0 && (
        <input type="hidden" name="property_type" value={selectedPropertyTypes.join(',')} />
      )}

      {/* Main row */}
      <div className="flex flex-col sm:flex-row gap-2 mb-2">
        <div className="flex-1">
          <input
            name="q"
            type="search"
            defaultValue={initialQ ?? ''}
            placeholder="¿Qué buscas?"
            className={inputClass + ' w-full'}
          />
        </div>

        <div className="sm:w-44">
          <select
            name="category"
            value={category}
            onChange={e => setCategory(e.target.value)}
            className={selectClass}
          >
            <option value="">Todas las categorías</option>
            {CATEGORIES.map(cat => (
              <option key={cat.key} value={cat.key}>{cat.label}</option>
            ))}
          </select>
        </div>

        <div className="sm:w-40">
          <select
            name="state"
            value={selectedState}
            onChange={e => setSelectedState(e.target.value)}
            className={selectClass}
          >
            <option value="">Todo México</option>
            {ESTADOS.map(e => (
              <option key={e.inegi_code} value={e.name}>{e.name}</option>
            ))}
          </select>
        </div>

        {selectedState && (
          <div className="sm:w-40">
            <select
              name="municipio"
              defaultValue={params.municipio ?? ''}
              className={selectClass}
            >
              <option value="">Todos los municipios</option>
              {(CITIES_BY_STATE[selectedState] ?? []).map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        )}

        <div className="sm:w-40">
          <select
            name="sort"
            defaultValue={params.sort ?? 'reciente'}
            className={selectClass}
          >
            {(category === 'autos' ? [...SORT_OPTIONS, ...AUTO_SORT_OPTIONS] : SORT_OPTIONS).map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          className="hidden sm:block bg-[var(--fg-inverse)] text-[var(--claim-accent)] font-semibold px-5 py-1.5 rounded-[var(--r-md)] text-sm hover:bg-white/90 transition-colors shrink-0"
        >
          Buscar
        </button>
      </div>

      {/* Search tip */}
      <p className="text-white/60 text-xs mb-3">
        Tip: usa - para excluir palabras: <em>guitarra -rota</em>
      </p>

      {/* Category-specific filters */}
      {category === 'autos' && (
        <div className="space-y-2 border-t border-white/20 pt-3">
          <div className="flex flex-wrap gap-2">
            <div className="flex-1 min-w-32">
              <label className={labelClass}>Marca</label>
              {/* Derived facet options + counts when the rail loaded; else free text. */}
              {carFacets && carFacets.marca.length > 0 ? (
                <select name="brand" defaultValue={params.brand ?? ''} className={selectClass}>
                  <option value="">Todas las marcas</option>
                  {carFacets.marca.map(o => (
                    <option key={o.value} value={o.value}>{o.label} ({o.count})</option>
                  ))}
                </select>
              ) : (
                <input name="brand" type="text" defaultValue={params.brand ?? ''} placeholder="Toyota, Honda..." className={inputClass} />
              )}
            </div>
            <div className="flex-1 min-w-32">
              <label className={labelClass}>Modelo</label>
              {/* Free-text input with datalist suggestions scoped to the applied marca. */}
              <input
                name="model"
                type="text"
                list="cars-modelo-options"
                defaultValue={params.model ?? ''}
                placeholder={params.brand ? 'Elige o escribe' : 'Corolla, Jetta...'}
                className={inputClass}
              />
              {carFacets && carFacets.modelo.length > 0 && (
                // Plain value options — a datalist inserts the option's `value`, and
                // count-in-text renders inconsistently across browsers; the marca
                // <select> carries the counts. The modelo input stays free-text so a
                // buyer can type a model the rail hasn't derived yet.
                <datalist id="cars-modelo-options">
                  {carFacets.modelo.map(o => (
                    <option key={o.value} value={o.value} />
                  ))}
                </datalist>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="w-28">
              <label className={labelClass}>Precio mín</label>
              <input name="min_price" type="number" defaultValue={params.min_price ?? ''} placeholder={carFacets?.precio ? String(carFacets.precio.min) : '0'} className={inputClass} />
            </div>
            <div className="w-28">
              <label className={labelClass}>Precio máx</label>
              <input name="max_price" type="number" defaultValue={params.max_price ?? ''} placeholder={carFacets?.precio ? String(carFacets.precio.max) : '∞'} className={inputClass} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="w-24">
              <label className={labelClass}>Año desde</label>
              <input name="year_from" type="number" defaultValue={params.year_from ?? ''} placeholder={carFacets?.anio ? String(carFacets.anio.min) : '2000'} maxLength={4} className={inputClass} />
            </div>
            <div className="w-24">
              <label className={labelClass}>Año hasta</label>
              <input name="year_to" type="number" defaultValue={params.year_to ?? ''} placeholder={carFacets?.anio ? String(carFacets.anio.max) : '2025'} maxLength={4} className={inputClass} />
            </div>
            <div className="w-28">
              <label className={labelClass}>Kms desde</label>
              <input name="km_from" type="number" defaultValue={params.km_from ?? ''} placeholder="0" className={inputClass} />
            </div>
            <div className="w-28">
              <label className={labelClass}>Kms hasta</label>
              <input name="km_to" type="number" defaultValue={params.km_to ?? ''} placeholder={carFacets?.km ? String(carFacets.km.max) : '∞'} className={inputClass} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="w-36">
              <label className={labelClass}>Transmisión</label>
              {/* Values match the capture-form attrs slugs (lib/listing-attributes.ts). */}
              <select name="transmission" defaultValue={params.transmission ?? ''} className={selectClass}>
                <option value="">Cualquiera</option>
                <option value="manual">Manual</option>
                <option value="automatico">Automático</option>
                <option value="cvt">CVT</option>
              </select>
            </div>
            <div className="w-36">
              <label className={labelClass}>Combustible</label>
              <select name="fuel" defaultValue={params.fuel ?? ''} className={selectClass}>
                <option value="">Cualquiera</option>
                <option value="gasolina">Gasolina</option>
                <option value="diesel">Diésel</option>
                <option value="electrico">Eléctrico</option>
                <option value="hibrido">Híbrido</option>
                <option value="gas_lp">Gas LP</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {category === 'inmuebles' && (
        <div className="space-y-2 border-t border-white/20 pt-3">
          <div className="flex flex-wrap gap-2">
            <div className="w-28">
              <label className={labelClass}>Precio mín</label>
              <input name="min_price" type="number" defaultValue={params.min_price ?? ''} placeholder="0" className={inputClass} />
            </div>
            <div className="w-28">
              <label className={labelClass}>Precio máx</label>
              <input name="max_price" type="number" defaultValue={params.max_price ?? ''} placeholder="∞" className={inputClass} />
            </div>
            <div className="w-28">
              <label className={labelClass}>Hab. mín</label>
              <input name="rooms_min" type="number" defaultValue={params.rooms_min ?? ''} placeholder="1" className={inputClass} />
            </div>
            <div className="w-28">
              <label className={labelClass}>Hab. máx</label>
              <input name="rooms_max" type="number" defaultValue={params.rooms_max ?? ''} placeholder="∞" className={inputClass} />
            </div>
            <div className="w-32">
              <label className={labelClass}>Superficie mín m²</label>
              <input name="surface_min" type="number" defaultValue={params.surface_min ?? ''} placeholder="0" className={inputClass} />
            </div>
            <div className="w-32">
              <label className={labelClass}>Superficie máx m²</label>
              <input name="surface_max" type="number" defaultValue={params.surface_max ?? ''} placeholder="∞" className={inputClass} />
            </div>
          </div>
          <div>
            <label className={labelClass}>Tipo de propiedad</label>
            <div className="flex flex-wrap gap-2 mt-1">
              {PROPERTY_TYPES.map(pt => (
                <label key={pt.value} className="flex items-center gap-1.5 text-white text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedPropertyTypes.includes(pt.value)}
                    onChange={() => togglePropertyType(pt.value)}
                    className="rounded-[var(--r-xs)]"
                  />
                  {pt.label}
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {category === 'electronica' && (
        <div className="border-t border-white/20 pt-3">
          <div className="flex flex-wrap gap-2">
            <div className="flex-1 min-w-32">
              <label className={labelClass}>Marca</label>
              <input name="brand" type="text" defaultValue={params.brand ?? ''} placeholder="Apple, Samsung..." className={inputClass} />
            </div>
            <div className="w-28">
              <label className={labelClass}>Precio mín</label>
              <input name="min_price" type="number" defaultValue={params.min_price ?? ''} placeholder="0" className={inputClass} />
            </div>
            <div className="w-28">
              <label className={labelClass}>Precio máx</label>
              <input name="max_price" type="number" defaultValue={params.max_price ?? ''} placeholder="∞" className={inputClass} />
            </div>
            <div className="w-40">
              <label className={labelClass}>Condición</label>
              <select name="condition" defaultValue={params.condition ?? ''} className={selectClass}>
                {CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
          </div>
        </div>
      )}

      {(category === 'hogar' || category === 'moda' || category === 'deportes' ||
        category === 'mascotas' || category === 'herramientas' || category === 'otros') && (
        <div className="border-t border-white/20 pt-3">
          <div className="flex flex-wrap gap-2">
            <div className="w-28">
              <label className={labelClass}>Precio mín</label>
              <input name="min_price" type="number" defaultValue={params.min_price ?? ''} placeholder="0" className={inputClass} />
            </div>
            <div className="w-28">
              <label className={labelClass}>Precio máx</label>
              <input name="max_price" type="number" defaultValue={params.max_price ?? ''} placeholder="∞" className={inputClass} />
            </div>
            <div className="w-40">
              <label className={labelClass}>Condición</label>
              <select name="condition" defaultValue={params.condition ?? ''} className={selectClass}>
                {CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
          </div>
        </div>
      )}

      {(category === 'servicios' || category === 'negocios') && (
        <div className="border-t border-white/20 pt-3">
          <div className="flex flex-wrap gap-2">
            <div className="w-28">
              <label className={labelClass}>Precio mín</label>
              <input name="min_price" type="number" defaultValue={params.min_price ?? ''} placeholder="0" className={inputClass} />
            </div>
            <div className="w-28">
              <label className={labelClass}>Precio máx</label>
              <input name="max_price" type="number" defaultValue={params.max_price ?? ''} placeholder="∞" className={inputClass} />
            </div>
          </div>
        </div>
      )}

      {/* Mobile-only apply bar — pinned to the bottom of the sheet. */}
      <div className="sm:hidden sticky bottom-0 -mx-4 -mb-4 mt-4 px-4 py-3 bg-[var(--claim-accent)] border-t border-white/20 flex items-center gap-3">
        <button
          type="button"
          onClick={clearFilters}
          className="text-white/80 hover:text-white text-sm font-medium shrink-0"
        >
          Limpiar
        </button>
        <button
          type="submit"
          className="flex-1 bg-[var(--fg-inverse)] text-[var(--claim-accent)] font-semibold px-5 py-2 rounded-[var(--r-md)] text-sm hover:bg-white/90 transition-colors"
        >
          {resultCountLabel(count)}
        </button>
      </div>
      </form>
      </BuyerShellPortal>
    </>
  )
}
