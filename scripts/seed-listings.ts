/**
 * seed-listings.ts — adds realistic inmuebles + autos listings with full metadata
 * so the advanced category-specific filters return real results.
 *
 * Usage:
 *   node --experimental-strip-types --env-file=.env.local scripts/seed-listings.ts
 *
 * Safe to re-run — upserts by source_url, never deletes.
 */

import { createClient } from '@supabase/supabase-js'

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// ─── helpers ──────────────────────────────────────────────────────────────────

function slug(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

async function upsertShop(s: {
  slug: string; name: string; description?: string; location: string; source_url: string
}) {
  const { data, error } = await db.from('marketplace_shops')
    .upsert({ ...s, source: 'scraped', verified: false }, { onConflict: 'slug' })
    .select('id').single()
  if (error) throw new Error(`Shop upsert ${s.slug}: ${error.message}`)
  return data!.id as string
}

async function upsertListing(l: Record<string, unknown>) {
  // Check for existing listing by source_url (no unique constraint — manual check)
  const { data: existing } = await db.from('marketplace_listings')
    .select('id').eq('source_url', l.source_url as string).maybeSingle()
  if (existing) return // already seeded
  const { error } = await db.from('marketplace_listings').insert(l)
  if (error) throw new Error(`Listing insert: ${error.message}`)
}

// ─── shops ────────────────────────────────────────────────────────────────────

const INMUEBLES_SHOP_ID = await upsertShop({
  slug: 'propiedades-bonsai-mx',
  name: 'Propiedades Bonsai MX',
  description: 'Casas, departamentos, locales y terrenos en todo México.',
  location: 'Ciudad de México',
  source_url: 'https://propiedades.miyagisanchez.com',
})

const AUTOS_SHOP_ID = await upsertShop({
  slug: 'seminuevos-bonsai',
  name: 'Seminuevos Bonsai',
  description: 'Autos seminuevos con garantía. Financiamiento disponible.',
  location: 'Ciudad de México',
  source_url: 'https://autos.miyagisanchez.com',
})

console.log('Shops ready:', INMUEBLES_SHOP_ID, AUTOS_SHOP_ID)

// ─── inmuebles ────────────────────────────────────────────────────────────────

const INMUEBLES: Array<{
  title: string; description: string; price_cents: number; location: string; state: string
  rooms?: number; surface?: number; property_type: string
}> = [
  {
    title: 'Departamento moderno en Condesa',
    description: 'Luminoso depto de 2 recámaras con balcón, cocina integral, 1 baño completo. A 5 min del Parque México. Incluye estacionamiento.',
    price_cents: 2_800_000 * 100,
    location: 'Colonia Condesa, CDMX',
    state: 'Ciudad de México',
    rooms: 2, surface: 68,
    property_type: 'departamento',
  },
  {
    title: 'Casa en Coyoacán — 3 recámaras',
    description: 'Casa colonial con patio central, sala, comedor, cocina amplia, 3 recámaras y 2.5 baños. Zona tranquila a 10 min del centro de Coyoacán.',
    price_cents: 5_200_000 * 100,
    location: 'Coyoacán, CDMX',
    state: 'Ciudad de México',
    rooms: 3, surface: 150,
    property_type: 'casa',
  },
  {
    title: 'Local comercial en Polanco — Renta',
    description: 'Local de 80m² en planta baja sobre Presidente Masaryk. Excelente flujo peatonal. Adaptable a restaurante, boutique u oficina.',
    price_cents: 45_000 * 100,
    location: 'Polanco, CDMX',
    state: 'Ciudad de México',
    surface: 80,
    property_type: 'local_comercial',
  },
  {
    title: 'Terreno en Querétaro — Zona industrial',
    description: 'Terreno plano de 500m² con acceso a avenida principal. Servicios completos (agua, luz, drenaje). Ideal para bodega o nave industrial.',
    price_cents: 1_800_000 * 100,
    location: 'Querétaro, QRO',
    state: 'Querétaro',
    surface: 500,
    property_type: 'terreno',
  },
  {
    title: 'Departamento en Guadalajara — Providencia',
    description: '1 recámara, sala-comedor integrado, cocina equipada, 1 baño. Edificio con gimnasio y área de coworking. Ideal para jóvenes profesionistas.',
    price_cents: 1_650_000 * 100,
    location: 'Providencia, Guadalajara',
    state: 'Jalisco',
    rooms: 1, surface: 52,
    property_type: 'departamento',
  },
  {
    title: 'Casa en Zapopan con alberca',
    description: 'Residencia 4 recámaras, 3 baños, sala de TV, cocina gourmet, jardín con alberca. Fraccionamiento privado con vigilancia 24h.',
    price_cents: 8_500_000 * 100,
    location: 'Zapopan, JAL',
    state: 'Jalisco',
    rooms: 4, surface: 280,
    property_type: 'casa',
  },
  {
    title: 'Penthouse en San Pedro Garza García',
    description: 'Penthouse de lujo 3 recámaras + estudio, 3 baños, terraza de 120m², vista a la Silla y al Cerro de la Silla. 2 cajones de estacionamiento.',
    price_cents: 12_000_000 * 100,
    location: 'San Pedro Garza García, NL',
    state: 'Nuevo León',
    rooms: 3, surface: 240,
    property_type: 'departamento',
  },
  {
    title: 'Casa en Monterrey — Santa Catarina',
    description: '3 recámaras, 2 baños, cochera techada para 2 autos, jardín trasero. Acabados de calidad. Crédito Infonavit y Fovissste aceptado.',
    price_cents: 2_900_000 * 100,
    location: 'Santa Catarina, NL',
    state: 'Nuevo León',
    rooms: 3, surface: 120,
    property_type: 'casa',
  },
  {
    title: 'Bodega en renta — Tlalnepantla',
    description: 'Bodega de 400m² con acceso para trailers, altura de 6m, oficina administrativa. Zona industrial consolidada, excelente conectividad.',
    price_cents: 38_000 * 100,
    location: 'Tlalnepantla, Edo. Méx',
    state: 'Estado de México',
    surface: 400,
    property_type: 'bodega',
  },
  {
    title: 'Departamento en renta — Roma Norte',
    description: '2 recámaras, 1 baño, cocina equipada, sala comedor. Edificio pet-friendly con roof garden. A 2 cuadras del metro Sonora.',
    price_cents: 18_500 * 100,
    location: 'Roma Norte, CDMX',
    state: 'Ciudad de México',
    rooms: 2, surface: 65,
    property_type: 'departamento',
  },
  {
    title: 'Casa en Mérida — Norte',
    description: 'Casa nueva en fraccionamiento privado. 3 recámaras, 2 baños, sala, comedor, cocina americana, patio con posibilidad de alberca.',
    price_cents: 2_200_000 * 100,
    location: 'Mérida, YUC',
    state: 'Yucatán',
    rooms: 3, surface: 130,
    property_type: 'casa',
  },
  {
    title: 'Oficina en Reforma — Piso 14',
    description: '120m² de oficina corporativa acondicionada. Piso 14 con vista a Paseo de la Reforma, sala de juntas, kitchenette, 2 baños.',
    price_cents: 85_000 * 100,
    location: 'Paseo de la Reforma, CDMX',
    state: 'Ciudad de México',
    surface: 120,
    property_type: 'oficina',
  },
]

for (const p of INMUEBLES) {
  await upsertListing({
    shop_id: INMUEBLES_SHOP_ID,
    title: p.title,
    description: p.description,
    price_cents: p.price_cents,
    currency: 'MXN',
    listing_type: 'product',
    location: p.location,
    state: p.state,
    category: 'inmuebles',
    source: 'manual',
    source_url: `manual://inmuebles/${slug(p.title)}`,
    images: [],
    status: 'active',
    metadata: {
      property_type: p.property_type,
      ...(p.rooms != null ? { rooms: p.rooms } : {}),
      ...(p.surface != null ? { surface: p.surface } : {}),
    },
  })
  process.stdout.write('.')
}
console.log(`\n✓ ${INMUEBLES.length} inmuebles listings`)

// ─── autos ────────────────────────────────────────────────────────────────────

const AUTOS: Array<{
  title: string; description: string; price_cents: number; location: string; state: string
  brand: string; year: number; km: number; transmission: string; fuel: string
}> = [
  {
    title: 'Honda Civic 2020 — Sport Turbo',
    description: 'Honda Civic Sport Turbo en excelente estado. 1 dueño, siempre agencia, historial de servicio completo. Llantas nuevas, sin choques.',
    price_cents: 335_000 * 100,
    location: 'Ciudad de México',
    state: 'Ciudad de México',
    brand: 'Honda', year: 2020, km: 38_000,
    transmission: 'automatico', fuel: 'gasolina',
  },
  {
    title: 'Toyota Hilux 2019 — Doble Cabina',
    description: 'Hilux TRD doble cabina 4x4, diesel. Accesorios de fábrica: portaequipaje, defensas. Ideal para trabajo y aventura. Facturable.',
    price_cents: 520_000 * 100,
    location: 'Guadalajara, JAL',
    state: 'Jalisco',
    brand: 'Toyota', year: 2019, km: 72_000,
    transmission: 'manual', fuel: 'diesel',
  },
  {
    title: 'Volkswagen Jetta 2022 — Comfortline',
    description: 'VW Jetta Comfortline 1.4 TSI automático. Color blanco, interiores negros, asientos de tela, pantalla táctil, CarPlay/Android Auto.',
    price_cents: 395_000 * 100,
    location: 'Monterrey, NL',
    state: 'Nuevo León',
    brand: 'Volkswagen', year: 2022, km: 21_500,
    transmission: 'automatico', fuel: 'gasolina',
  },
  {
    title: 'Nissan Frontier 2021 — Pro-4X',
    description: 'Frontier Pro-4X 4x4 V6, color gris oscuro. Equipada: llantas BFGoodrich, doble diferencial, toma 110V en caja. Lista para off-road.',
    price_cents: 498_000 * 100,
    location: 'Puebla, PUE',
    state: 'Puebla',
    brand: 'Nissan', year: 2021, km: 45_000,
    transmission: 'automatico', fuel: 'gasolina',
  },
  {
    title: 'Mazda 3 2023 — Sedán iPlus',
    description: 'Mazda 3 iPlus 2.0L automático. Color rojo Soul, 1 dueño, garantía de agencia vigente. Tecnología de seguridad MRCC, BSM, RCTA.',
    price_cents: 415_000 * 100,
    location: 'Ciudad de México',
    state: 'Ciudad de México',
    brand: 'Mazda', year: 2023, km: 15_000,
    transmission: 'automatico', fuel: 'gasolina',
  },
  {
    title: 'Ford F-150 2018 — XLT 4x4',
    description: 'F-150 XLT cabina y media, motor 5.0 V8. Tracción 4x4 electrónica, caja de 5.5 pies. Excelente para trabajo pesado o remolque.',
    price_cents: 445_000 * 100,
    location: 'Tijuana, BC',
    state: 'Baja California',
    brand: 'Ford', year: 2018, km: 95_000,
    transmission: 'automatico', fuel: 'gasolina',
  },
  {
    title: 'Kia Sportage 2021 — GT Line',
    description: 'Sportage GT Line 2.0L automático. Techo panorámico, asientos ventilados, cámara 360°, sistema de frenado autónomo. 1 dueño.',
    price_cents: 420_000 * 100,
    location: 'León, GTO',
    state: 'Guanajuato',
    brand: 'Kia', year: 2021, km: 33_000,
    transmission: 'automatico', fuel: 'gasolina',
  },
  {
    title: 'Chevrolet Aveo 2019 — LT',
    description: 'Aveo LT 1.5L TM, color blanco, 2 dueños, transmisión manual en perfectas condiciones. Económico, ideal para ciudad. Tenencia al corriente.',
    price_cents: 168_000 * 100,
    location: 'Querétaro, QRO',
    state: 'Querétaro',
    brand: 'Chevrolet', year: 2019, km: 58_000,
    transmission: 'manual', fuel: 'gasolina',
  },
  {
    title: 'BMW Serie 3 2020 — 320i Sport',
    description: 'BMW 320i Sport Line, color negro zafiro, 1 dueño. Techo solar, navegación iDrive, asientos deportivos, llantas 18". Agencia BMW Satélite.',
    price_cents: 695_000 * 100,
    location: 'Naucalpan, Edo. Méx',
    state: 'Estado de México',
    brand: 'BMW', year: 2020, km: 28_000,
    transmission: 'automatico', fuel: 'gasolina',
  },
  {
    title: 'Hyundai Tucson 2022 — GLS Premium',
    description: 'Tucson GLS Premium 2.5L automático. Sistema BlueLink, asientos de piel calefaccionados, HUD, cargador inalámbrico. Garantía activa.',
    price_cents: 455_000 * 100,
    location: 'Guadalajara, JAL',
    state: 'Jalisco',
    brand: 'Hyundai', year: 2022, km: 18_000,
    transmission: 'automatico', fuel: 'gasolina',
  },
  {
    title: 'Suzuki Jimny 2021 — GL',
    description: 'Jimny GL 4x4 1.5L manual, color verde bosque. Motor ALLGRIP PRO, diferencial trasero, bajo perfil. Cult car, muy difícil de conseguir.',
    price_cents: 380_000 * 100,
    location: 'Ciudad de México',
    state: 'Ciudad de México',
    brand: 'Suzuki', year: 2021, km: 24_000,
    transmission: 'manual', fuel: 'gasolina',
  },
  {
    title: 'Tesla Model 3 2021 — Standard Range',
    description: 'Model 3 Standard Range Plus, color azul medianoche. Autopilot activado, 400km de autonomía. Cargador tipo 2 incluido. Sin placas de circulación.',
    price_cents: 780_000 * 100,
    location: 'Ciudad de México',
    state: 'Ciudad de México',
    brand: 'Tesla', year: 2021, km: 32_000,
    transmission: 'automatico', fuel: 'electrico',
  },
  {
    title: 'Dodge RAM 1500 2020 — Laramie',
    description: 'RAM 1500 Laramie 5.7 HEMI V8, color negro. Asientos de piel caoba, sistema Uconnect 12", caja de 5.7 pies, suspensión neumática.',
    price_cents: 890_000 * 100,
    location: 'Hermosillo, SON',
    state: 'Sonora',
    brand: 'Dodge', year: 2020, km: 52_000,
    transmission: 'automatico', fuel: 'gasolina',
  },
  {
    title: 'Volkswagen Tiguan 2023 — Comfortline',
    description: 'Tiguan Comfortline 1.4 TSI automático, color blanco plata. 3 filas de asientos (7 pasajeros), pantalla 8", CarPlay. Garantía de agencia.',
    price_cents: 565_000 * 100,
    location: 'San Luis Potosí, SLP',
    state: 'San Luis Potosí',
    brand: 'Volkswagen', year: 2023, km: 8_000,
    transmission: 'automatico', fuel: 'gasolina',
  },
  {
    title: 'Renault Duster 2020 — Intens 4x4',
    description: 'Duster Intens 4x4 2.0L manual, color naranja volcán. Techo pintado negro, rieles cromados, doble airbag. Ideal para caminos rurales.',
    price_cents: 248_000 * 100,
    location: 'Oaxaca, OAX',
    state: 'Oaxaca',
    brand: 'Renault', year: 2020, km: 61_000,
    transmission: 'manual', fuel: 'gasolina',
  },
]

for (const a of AUTOS) {
  await upsertListing({
    shop_id: AUTOS_SHOP_ID,
    title: a.title,
    description: a.description,
    price_cents: a.price_cents,
    currency: 'MXN',
    condition: 'good',
    listing_type: 'product',
    location: a.location,
    state: a.state,
    category: 'autos',
    source: 'manual',
    source_url: `manual://autos/${slug(a.title)}`,
    images: [],
    status: 'active',
    metadata: {
      brand: a.brand,
      year: a.year,
      km: a.km,
      transmission: a.transmission,
      fuel: a.fuel,
    },
  })
  process.stdout.write('.')
}
console.log(`\n✓ ${AUTOS.length} autos listings`)
console.log('\nAll done!')
