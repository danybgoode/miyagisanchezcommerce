'use client'

import { useState, useRef } from 'react'
import { CATEGORIES, CITIES_BY_STATE } from '@/lib/types'
import { ESTADOS } from '@/lib/mx-locations'
import type { SearchParams, SortOption } from '@/lib/types'

type SearchBarProps = {
  initialQ?: string
  initialCategory?: string
  initialState?: string
  params: SearchParams
}

const SORT_OPTIONS: { value: SortOption | ''; label: string }[] = [
  { value: 'reciente', label: 'Más recientes' },
  { value: 'precio_asc', label: 'Menor precio' },
  { value: 'precio_desc', label: 'Mayor precio' },
  { value: 'popular', label: 'Más vistos' },
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

export default function SearchBar({ initialQ, initialCategory, initialState, params }: SearchBarProps) {
  const [category, setCategory] = useState(initialCategory ?? '')
  const [selectedState, setSelectedState] = useState(initialState ?? '')
  const [selectedPropertyTypes, setSelectedPropertyTypes] = useState<string[]>(
    params.property_type ? params.property_type.split(',').filter(Boolean) : []
  )
  const formRef = useRef<HTMLFormElement>(null)

  function togglePropertyType(value: string) {
    setSelectedPropertyTypes(prev =>
      prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]
    )
  }

  const inputClass = 'border border-white/30 bg-white/20 text-white placeholder-white/70 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-white focus:bg-white/30 w-full'
  const labelClass = 'text-white/80 text-xs mb-0.5 block'
  const selectClass = 'border border-white/30 bg-white/20 text-white rounded px-2 py-1.5 text-sm focus:outline-none focus:border-white w-full [&>option]:text-[var(--color-text)] [&>option]:bg-white'

  return (
    <form ref={formRef} method="GET" action="/l" className="rounded-xl p-4 bg-[#3a8a7a] mb-6">
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
              <option key={cat.key} value={cat.key}>{cat.icon} {cat.label}</option>
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
            {SORT_OPTIONS.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          className="bg-white text-[#3a8a7a] font-semibold px-5 py-1.5 rounded text-sm hover:bg-white/90 transition-colors shrink-0"
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
              <input name="brand" type="text" defaultValue={params.brand ?? ''} placeholder="Toyota, Honda..." className={inputClass} />
            </div>
            <div className="w-28">
              <label className={labelClass}>Precio mín</label>
              <input name="min_price" type="number" defaultValue={params.min_price ?? ''} placeholder="0" className={inputClass} />
            </div>
            <div className="w-28">
              <label className={labelClass}>Precio máx</label>
              <input name="max_price" type="number" defaultValue={params.max_price ?? ''} placeholder="∞" className={inputClass} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="w-24">
              <label className={labelClass}>Año desde</label>
              <input name="year_from" type="number" defaultValue={params.year_from ?? ''} placeholder="2000" maxLength={4} className={inputClass} />
            </div>
            <div className="w-24">
              <label className={labelClass}>Año hasta</label>
              <input name="year_to" type="number" defaultValue={params.year_to ?? ''} placeholder="2025" maxLength={4} className={inputClass} />
            </div>
            <div className="w-28">
              <label className={labelClass}>Kms desde</label>
              <input name="km_from" type="number" defaultValue={params.km_from ?? ''} placeholder="0" className={inputClass} />
            </div>
            <div className="w-28">
              <label className={labelClass}>Kms hasta</label>
              <input name="km_to" type="number" defaultValue={params.km_to ?? ''} placeholder="∞" className={inputClass} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="w-36">
              <label className={labelClass}>Transmisión</label>
              <select name="transmission" defaultValue={params.transmission ?? ''} className={selectClass}>
                <option value="">Cualquiera</option>
                <option value="manual">Manual</option>
                <option value="automatica">Automática</option>
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
                <option value="gas">Gas</option>
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
                    className="rounded"
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
    </form>
  )
}
