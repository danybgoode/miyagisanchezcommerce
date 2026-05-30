'use client'

export type Attrs = Record<string, string | number | boolean>

export type ListingType = 'product' | 'service' | 'rental' | 'digital' | 'subscription'

function AttrSelect({ label, attrKey, options, attrs, setAttr, required }: {
  label: string; attrKey: string; options: { value: string; label: string }[]
  attrs: Attrs; setAttr: (k: string, v: string) => void; required?: boolean
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-[var(--color-text)] mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <select
        value={(attrs[attrKey] as string) ?? ''}
        onChange={e => setAttr(attrKey, e.target.value)}
        className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent"
      >
        <option value="">Seleccionar…</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

function AttrText({ label, attrKey, placeholder, attrs, setAttr, maxLength }: {
  label: string; attrKey: string; placeholder?: string
  attrs: Attrs; setAttr: (k: string, v: string) => void; maxLength?: number
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-[var(--color-text)] mb-1">{label}</label>
      <input
        type="text"
        value={(attrs[attrKey] as string) ?? ''}
        onChange={e => setAttr(attrKey, e.target.value.slice(0, maxLength ?? 80))}
        placeholder={placeholder}
        className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent"
      />
    </div>
  )
}

function AttrNumber({ label, attrKey, placeholder, attrs, setAttr, min, max }: {
  label: string; attrKey: string; placeholder?: string
  attrs: Attrs; setAttr: (k: string, v: string) => void; min?: number; max?: number
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-[var(--color-text)] mb-1">{label}</label>
      <input
        type="number"
        inputMode="numeric"
        value={(attrs[attrKey] as string) ?? ''}
        onChange={e => setAttr(attrKey, e.target.value)}
        placeholder={placeholder}
        min={min}
        max={max}
        className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent"
      />
    </div>
  )
}

const CLOTHING_SIZES = [
  'XS','S','M','L','XL','XXL','XXXL','Talla única','Otro',
  '4','6','8','10','12','14','16','18','20','22','24',
  '28','30','32','34','36','38','40','42','44',
]

export function AttrsSection({ category, listingType, attrs, setAttr }: {
  category: string; listingType: ListingType; attrs: Attrs; setAttr: (k: string, v: string) => void
}) {
  if (listingType === 'digital' || listingType === 'subscription') return null

  if (category === 'autos') return (
    <div className="space-y-3 border border-amber-200 bg-amber-50/60 rounded-xl p-4">
      <p className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wide">Características del vehículo</p>
      <div className="grid grid-cols-2 gap-3">
        <AttrText label="Marca" attrKey="make" placeholder="Toyota, Honda, VW…" attrs={attrs} setAttr={setAttr} />
        <AttrText label="Modelo" attrKey="model" placeholder="Corolla, Civic…" attrs={attrs} setAttr={setAttr} />
        <AttrNumber label="Año" attrKey="year" placeholder="2020" attrs={attrs} setAttr={setAttr} min={1900} max={new Date().getFullYear() + 1} />
        <AttrNumber label="Kilómetros" attrKey="km" placeholder="45 000" attrs={attrs} setAttr={setAttr} min={0} />
        <AttrSelect label="Combustible" attrKey="fuel_type" attrs={attrs} setAttr={setAttr} options={[
          { value: 'gasolina', label: 'Gasolina' },
          { value: 'diesel', label: 'Diésel' },
          { value: 'hibrido', label: 'Híbrido' },
          { value: 'electrico', label: 'Eléctrico' },
          { value: 'gas_lp', label: 'Gas LP' },
        ]} />
        <AttrSelect label="Transmisión" attrKey="transmission" attrs={attrs} setAttr={setAttr} options={[
          { value: 'automatico', label: 'Automático' },
          { value: 'manual', label: 'Manual' },
          { value: 'cvt', label: 'CVT' },
        ]} />
        <AttrText label="Color" attrKey="color" placeholder="Blanco, Rojo…" attrs={attrs} setAttr={setAttr} />
      </div>
    </div>
  )

  if (category === 'inmuebles') return (
    <div className="space-y-3 border border-blue-200 bg-blue-50/60 rounded-xl p-4">
      <p className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wide">Características del inmueble</p>
      <div className="grid grid-cols-2 gap-3">
        <AttrSelect label="Tipo" attrKey="property_type" attrs={attrs} setAttr={setAttr} options={[
          { value: 'casa', label: 'Casa' },
          { value: 'departamento', label: 'Departamento' },
          { value: 'local', label: 'Local comercial' },
          { value: 'terreno', label: 'Terreno' },
          { value: 'oficina', label: 'Oficina' },
          { value: 'bodega', label: 'Bodega' },
        ]} />
        <AttrNumber label="Superficie m²" attrKey="area_m2" placeholder="65" attrs={attrs} setAttr={setAttr} min={1} />
        <AttrNumber label="Recámaras" attrKey="bedrooms" placeholder="3" attrs={attrs} setAttr={setAttr} min={0} max={20} />
        <AttrNumber label="Baños" attrKey="bathrooms" placeholder="2" attrs={attrs} setAttr={setAttr} min={0} max={20} />
        <AttrNumber label="Estacionamientos" attrKey="parking_spots" placeholder="1" attrs={attrs} setAttr={setAttr} min={0} max={10} />
        <AttrSelect label="Amueblado" attrKey="furnished" attrs={attrs} setAttr={setAttr} options={[
          { value: 'sin_amueblar', label: 'Sin amueblar' },
          { value: 'semi_amueblado', label: 'Semi-amueblado' },
          { value: 'amueblado', label: 'Completamente amueblado' },
        ]} />
      </div>
    </div>
  )

  if (category === 'moda') return (
    <div className="space-y-3 border border-pink-200 bg-pink-50/60 rounded-xl p-4">
      <p className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wide">Características de la prenda</p>
      <div className="grid grid-cols-2 gap-3">
        <AttrText label="Marca" attrKey="brand" placeholder="Zara, Nike, H&M…" attrs={attrs} setAttr={setAttr} />
        <AttrSelect label="Talla" attrKey="size" attrs={attrs} setAttr={setAttr} options={
          CLOTHING_SIZES.map(s => ({ value: s.toLowerCase().replace(/\s/g, '_'), label: s }))
        } />
        <AttrSelect label="Género" attrKey="gender" attrs={attrs} setAttr={setAttr} options={[
          { value: 'mujer', label: 'Mujer' },
          { value: 'hombre', label: 'Hombre' },
          { value: 'unisex', label: 'Unisex' },
          { value: 'nino', label: 'Niño' },
          { value: 'nina', label: 'Niña' },
          { value: 'bebe', label: 'Bebé' },
        ]} />
        <AttrText label="Color" attrKey="color" placeholder="Negro, Azul marino…" attrs={attrs} setAttr={setAttr} />
        <AttrText label="Material" attrKey="material" placeholder="Algodón, Poliéster…" attrs={attrs} setAttr={setAttr} />
      </div>
    </div>
  )

  if (category === 'electronica') return (
    <div className="space-y-3 border border-indigo-200 bg-indigo-50/60 rounded-xl p-4">
      <p className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wide">Características del producto</p>
      <div className="grid grid-cols-2 gap-3">
        <AttrText label="Marca" attrKey="brand" placeholder="Apple, Samsung, Sony…" attrs={attrs} setAttr={setAttr} />
        <AttrText label="Modelo" attrKey="model" placeholder="iPhone 14, Galaxy S24…" attrs={attrs} setAttr={setAttr} />
        <AttrText label="Almacenamiento" attrKey="storage" placeholder="128 GB, 256 GB…" attrs={attrs} setAttr={setAttr} maxLength={30} />
        <AttrText label="Color" attrKey="color" placeholder="Negro espacial, Blanco…" attrs={attrs} setAttr={setAttr} />
      </div>
    </div>
  )

  if (category === 'servicios' || listingType === 'service') return (
    <div className="space-y-3 border border-green-200 bg-green-50/60 rounded-xl p-4">
      <p className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wide">Detalles del servicio</p>
      <div className="grid grid-cols-2 gap-3">
        <AttrSelect label="Modalidad" attrKey="modality" attrs={attrs} setAttr={setAttr} options={[
          { value: 'presencial', label: 'Presencial' },
          { value: 'online', label: 'Online / Remoto' },
          { value: 'domicilio', label: 'A domicilio' },
          { value: 'mixto', label: 'Mixto' },
        ]} />
        <AttrText label="Duración estimada" attrKey="duration" placeholder="1 hora, 2 hrs…" attrs={attrs} setAttr={setAttr} maxLength={30} />
        <AttrNumber label="Años de experiencia" attrKey="experience_years" placeholder="5" attrs={attrs} setAttr={setAttr} min={0} max={60} />
      </div>
    </div>
  )

  if (['hogar','herramientas','deportes','mascotas','negocios','cursos','creatividad','comunidad','otros'].includes(category)) return (
    <div className="grid grid-cols-2 gap-3">
      <AttrText label="Marca (opcional)" attrKey="brand" placeholder="Marca del producto" attrs={attrs} setAttr={setAttr} />
      <AttrText label="Color (opcional)" attrKey="color" placeholder="Color principal" attrs={attrs} setAttr={setAttr} />
    </div>
  )

  return null
}
