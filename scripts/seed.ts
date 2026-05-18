/**
 * Seed script — populates miyagisanchez.com with realistic sample data.
 *
 * Usage (from the miyagisanchez app directory):
 *   node --experimental-strip-types --env-file=.env.local scripts/seed.ts
 *
 * It is safe to re-run: shops and listings are upserted on slug / source_url.
 * Pass --clear to wipe all rows first.
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const CLEAR = process.argv.includes('--clear')

// ──────────────────────────────────────────────────────────────────────────────
// Shops
// ──────────────────────────────────────────────────────────────────────────────
const SHOPS = [
  {
    slug: 'bonsai-sagrado',
    name: 'Bonsai Sagrado',
    description: 'Especialistas en bonsái desde 1998. Árboles, macetas, herramientas y cursos presenciales en CDMX.',
    location: 'Ciudad de México, CDMX',
    logo_url: null,
    clerk_user_id: null,            // unclaimed — scraped shop
    verified: false,
    source: 'scraped',
    source_url: 'https://example-marketplace.com/shops/bonsai-sagrado',
  },
  {
    slug: 'jardin-zen-mx',
    name: 'Jardín Zen MX',
    description: 'Venta de plantas de interior, cactáceas y suculentas. Envíos a toda la república.',
    location: 'Guadalajara, JAL',
    logo_url: null,
    clerk_user_id: null,
    verified: true,
    source: 'manual',
    source_url: null,
  },
  {
    slug: 'taller-raiz',
    name: 'Taller Raíz',
    description: 'Servicio de mantenimiento, estilizado y trasplante de bonsái. Hacemos llamadas a domicilio en GDL.',
    location: 'Guadalajara, JAL',
    logo_url: null,
    clerk_user_id: null,
    verified: true,
    source: 'manual',
    source_url: null,
  },
  {
    slug: 'ceramica-tepic',
    name: 'Cerámica Tepic',
    description: 'Macetas artesanales hechas a mano. Todos los tamaños y estilos para bonsái y plantas de exterior.',
    location: 'Tepic, NAY',
    logo_url: null,
    clerk_user_id: null,
    verified: false,
    source: 'scraped',
    source_url: 'https://example-marketplace.com/shops/ceramica-tepic',
  },
]

// ──────────────────────────────────────────────────────────────────────────────
// Listings per shop (shop_slug → listings[])
// ──────────────────────────────────────────────────────────────────────────────
type ListingInput = {
  title: string
  description: string
  price_cents: number | null
  currency: string
  condition: 'new' | 'like_new' | 'good' | 'fair' | 'parts' | null
  listing_type: 'product' | 'service' | 'rental'
  category?: string
  state?: string
  location: string
  images: { url: string; alt?: string }[]
  tags: string[]
  metadata?: Record<string, unknown>
}

const LISTINGS_BY_SHOP: Record<string, ListingInput[]> = {
  'bonsai-sagrado': [
    {
      title: 'Ficus retusa 12 años — estilo informal',
      description: 'Ficus retusa de 12 años de cultivo. Nebari definido, tronco con buen movimiento. Maceta de barro japonesa. Altura 35 cm.',
      price_cents: 280000,
      currency: 'MXN',
      condition: 'like_new',
      listing_type: 'product',
      category: 'hogar',
      state: 'Ciudad de México',
      location: 'CDMX',
      images: [
        { url: 'https://images.unsplash.com/photo-1599598425984-24d15d3b87f5?w=600', alt: 'Ficus retusa bonsái' },
      ],
      tags: ['ficus', 'bonsai', 'interior'],
    },
    {
      title: 'Juniperus chinensis 7 años — estilo cascada',
      description: 'Juniperus chinensis en estilo kengai (cascada). Follaje denso, nebari incipiente. Incluye maceta cerámica artesanal.',
      price_cents: 180000,
      currency: 'MXN',
      condition: 'like_new',
      listing_type: 'product',
      location: 'CDMX',
      images: [
        { url: 'https://images.unsplash.com/photo-1608501078713-8e445a709b39?w=600', alt: 'Juniperus bonsái cascada' },
      ],
      tags: ['juniperus', 'bonsai', 'exterior', 'cascada'],
    },
    {
      title: 'Azalea satsuki 5 años — floración rosada',
      description: 'Azalea satsuki en plena floración. Flores rosas dobles, muy ramificada. Incluye sustrato y maceta de plástico temporal.',
      price_cents: 120000,
      currency: 'MXN',
      condition: 'new',
      listing_type: 'product',
      location: 'CDMX',
      images: [
        { url: 'https://images.unsplash.com/photo-1490750967868-88df5691cc4c?w=600', alt: 'Azalea satsuki en flor' },
      ],
      tags: ['azalea', 'satsuki', 'bonsai', 'floracion'],
    },
    {
      title: 'Kit herramientas bonsái — 8 piezas profesionales',
      description: 'Set completo: tijeras de precisión, alicate cortaramas, cuchillo de injerto, paleta, alambre 1.5mm y 2.5mm, espatula y pinzas. Acero inoxidable.',
      price_cents: 85000,
      currency: 'MXN',
      condition: 'new',
      listing_type: 'product',
      location: 'CDMX',
      images: [
        { url: 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=600', alt: 'Herramientas bonsái' },
      ],
      tags: ['herramientas', 'tijeras', 'bonsai', 'acero'],
    },
    {
      title: 'Sustrato mezcla profesional — bolsa 5 litros',
      description: 'Mezcla balanceada: akadama 40%, pumita 30%, kiryu 30%. Ideal para coníferas y caducifolios. Sin tierra vegetal.',
      price_cents: 22000,
      currency: 'MXN',
      condition: 'new',
      listing_type: 'product',
      location: 'CDMX',
      images: [],
      tags: ['sustrato', 'akadama', 'pumita', 'bonsai'],
    },
    {
      title: 'Portainjertos de olmo — lote de 3 materiales',
      description: 'Tres olmos siberianos (Ulmus parvifolia) de 3 años, listos para formar. Altura 25-30 cm, diámetro de tronco 1.5-2 cm.',
      price_cents: 65000,
      currency: 'MXN',
      condition: 'good',
      listing_type: 'product',
      location: 'CDMX',
      images: [],
      tags: ['olmo', 'ulmus', 'material', 'bonsai'],
    },
  ],

  'jardin-zen-mx': [
    {
      title: 'Cactus saguaro miniatura — 15 cm',
      description: 'Cactus saguaro cultivado en maceta 10 cm. Crece muy lento, ideal para escritorio. Incluye sustrato especial para cactáceas.',
      price_cents: 28000,
      currency: 'MXN',
      condition: 'new',
      listing_type: 'product',
      location: 'Guadalajara',
      images: [
        { url: 'https://images.unsplash.com/photo-1523531294919-4bcd7c65e216?w=600', alt: 'Cactus saguaro miniatura' },
      ],
      tags: ['cactus', 'saguaro', 'suculenta', 'escritorio'],
    },
    {
      title: 'Echeveria lila — colección 6 variedades',
      description: 'Set de 6 echeverias en tonos lila, azul y verde. Cada una en maceta plástica 7 cm. Perfectas para arreglos y terrariums.',
      price_cents: 38000,
      currency: 'MXN',
      condition: 'new',
      listing_type: 'product',
      location: 'Guadalajara',
      images: [
        { url: 'https://images.unsplash.com/photo-1459411552884-841db9b3cc2a?w=600', alt: 'Echeverias de colores' },
      ],
      tags: ['echeveria', 'suculenta', 'coleccion', 'interior'],
    },
    {
      title: 'Ficus lyrata (pandurata) — 80 cm',
      description: 'Ficus lyrata (planta de violín) de 80 cm de alto. Hojas largas y brillantes sin manchas. Lista para interior luminoso.',
      price_cents: 92000,
      currency: 'MXN',
      condition: 'new',
      listing_type: 'product',
      location: 'Guadalajara',
      images: [
        { url: 'https://images.unsplash.com/photo-1586348943529-beaae6c28db9?w=600', alt: 'Ficus lyrata planta de violín' },
      ],
      tags: ['ficus', 'lyrata', 'interior', 'decoracion'],
    },
    {
      title: 'Monstera deliciosa — hoja fenestrada grande',
      description: 'Monstera adulta con múltiples hojas fenestradas. Maceta 25 cm, altura de planta ~90 cm. Lista para sala o comedor.',
      price_cents: 75000,
      currency: 'MXN',
      condition: 'new',
      listing_type: 'product',
      location: 'Guadalajara',
      images: [
        { url: 'https://images.unsplash.com/photo-1614594975525-e45190c55d0b?w=600', alt: 'Monstera deliciosa adulta' },
      ],
      tags: ['monstera', 'interior', 'tropical', 'decoracion'],
    },
    {
      title: 'Aloe vera XXL — planta medicinal',
      description: 'Aloe vera de más de 4 años, maceta 20 cm. Gel abundante, sin pesticidas. Con 3-4 hijuelos incluidos.',
      price_cents: 18000,
      currency: 'MXN',
      condition: 'new',
      listing_type: 'product',
      location: 'Guadalajara',
      images: [],
      tags: ['aloe', 'medicinal', 'suculenta', 'exterior'],
    },
    {
      title: 'Envío express GDL → CDMX — plantas medianas',
      description: 'Servicio de envío especializado para plantas de tamaño mediano (hasta 60 cm). Embalaje con musgo y cartón. Entrega en 24-48 h.',
      price_cents: 32000,
      currency: 'MXN',
      condition: null,
      listing_type: 'service',
      location: 'Nacional',
      images: [],
      tags: ['envio', 'logistica', 'plantas'],
    },
  ],

  'taller-raiz': [
    {
      title: 'Mantenimiento bonsái a domicilio (GDL)',
      description: 'Visita a domicilio en Guadalajara: revisión, poda de mantenimiento, revisión de raíces y guía personalizada de cuidados. Dura ~2 horas.',
      price_cents: 95000,
      currency: 'MXN',
      condition: null,
      listing_type: 'service',
      location: 'Guadalajara',
      images: [],
      tags: ['servicio', 'mantenimiento', 'bonsai', 'domicilio'],
    },
    {
      title: 'Taller: Primer bonsái — 4 sesiones',
      description: 'Curso de bonsái para principiantes: 4 sesiones de 2 horas. Incluye material vivo (Ficus retusa), maceta, sustrato y herramientas básicas.',
      price_cents: 220000,
      currency: 'MXN',
      condition: null,
      listing_type: 'service',
      location: 'Guadalajara',
      images: [
        { url: 'https://images.unsplash.com/photo-1448375240586-882707db888b?w=600', alt: 'Taller de bonsái' },
      ],
      tags: ['taller', 'curso', 'bonsai', 'principiantes'],
    },
    {
      title: 'Estilizado profesional — árbol hasta 50 cm',
      description: 'Estilizado y diseño de bonsái en taller (árbol no incluido). Incluye: definición de apex, selección de ramas, limpieza de jin y aplicación de pasta selladora.',
      price_cents: 140000,
      currency: 'MXN',
      condition: null,
      listing_type: 'service',
      location: 'Guadalajara',
      images: [],
      tags: ['servicio', 'estilizado', 'bonsai', 'diseno'],
    },
    {
      title: 'Renta mensual: espacio en vivero con riego automático',
      description: 'Deja tu bonsái en cuidado profesional: macrobiotunnel con riego por nebulización, fertilización quincenal y poda preventiva. Ideal para viajeros.',
      price_cents: 85000,
      currency: 'MXN',
      condition: null,
      listing_type: 'rental',
      location: 'Guadalajara',
      images: [],
      tags: ['renta', 'vivero', 'cuidados', 'bonsai'],
    },
    {
      title: 'Consultoría online — diagnóstico de problemas',
      description: 'Sesión de 45 min por videollamada. Diagnóstico de enfermedades, plagas, problemas de sustrato o de diseño. Incluye informe escrito con recomendaciones.',
      price_cents: 55000,
      currency: 'MXN',
      condition: null,
      listing_type: 'service',
      location: 'Nacional',
      images: [],
      tags: ['consultoria', 'online', 'bonsai', 'diagnostico'],
    },
  ],

  'ceramica-tepic': [
    {
      title: 'Maceta tokoname rectangular — 30×20 cm',
      description: 'Réplica artesanal estilo tokoname. Barro rojo sin barniz, orificio de drenaje doble. Ideal para árboles de hoja caduca.',
      price_cents: 48000,
      currency: 'MXN',
      condition: 'new',
      listing_type: 'product',
      location: 'Tepic',
      images: [],
      tags: ['maceta', 'tokoname', 'bonsai', 'ceramica'],
    },
    {
      title: 'Maceta oval de barro azul — 25 cm',
      description: 'Maceta artesanal pintada a mano, esmalte azul marino satinado. Fondo con cuatro patas y drenaje amplio. Excelente para coníferas.',
      price_cents: 38000,
      currency: 'MXN',
      condition: 'new',
      listing_type: 'product',
      location: 'Tepic',
      images: [
        { url: 'https://images.unsplash.com/photo-1485955900006-10f4d324d411?w=600', alt: 'Maceta azul artesanal' },
      ],
      tags: ['maceta', 'ceramica', 'azul', 'bonsai'],
    },
    {
      title: 'Suiban de barro natural — base plana 40 cm',
      description: 'Suiban (bandeja de agua) para exposiciones. Barro natural sin esmalte, patina tipo antiguo. Diámetro 40 cm, profundidad 3 cm.',
      price_cents: 55000,
      currency: 'MXN',
      condition: 'new',
      listing_type: 'product',
      location: 'Tepic',
      images: [],
      tags: ['suiban', 'maceta', 'exposicion', 'bonsai'],
    },
    {
      title: 'Lote 5 macetas pequeñas — mezcla de estilos',
      description: 'Cinco macetas de 10-15 cm en diferentes formas (redonda, oval, hexagonal, cuadrada, en abanico). Perfectas para shohin y mame bonsái.',
      price_cents: 72000,
      currency: 'MXN',
      condition: 'new',
      listing_type: 'product',
      location: 'Tepic',
      images: [],
      tags: ['maceta', 'shohin', 'mame', 'lote', 'ceramica'],
    },
  ],
}

// ──────────────────────────────────────────────────────────────────────────────
// Runner
// ──────────────────────────────────────────────────────────────────────────────
async function main() {
  if (CLEAR) {
    console.log('Clearing existing data…')
    await db.from('marketplace_claims').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    await db.from('marketplace_listings').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    await db.from('marketplace_shops').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    console.log('Cleared.')
  }

  let totalShops = 0
  let totalListings = 0
  const errors: string[] = []

  for (const shop of SHOPS) {
    // Upsert shop by slug
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: shopRow, error: shopErr } = await db
      .from('marketplace_shops')
      .upsert(shop as any, { onConflict: 'slug', ignoreDuplicates: false })
      .select('id, slug')
      .single()

    if (shopErr || !shopRow) {
      errors.push(`Shop ${shop.slug}: ${shopErr?.message ?? 'no data returned'}`)
      continue
    }
    totalShops++
    console.log(`  ✓ Shop: ${shop.name} (${shopRow.id})`)

    const listings = LISTINGS_BY_SHOP[shop.slug] ?? []
    for (const listing of listings) {
      const { error: listErr } = await db.from('marketplace_listings').insert({
        shop_id: shopRow.id,
        ...listing,
        status: 'active',
        source: 'manual',
      })
      if (listErr) {
        errors.push(`Listing "${listing.title}": ${listErr.message}`)
      } else {
        totalListings++
        process.stdout.write('    + ' + listing.title.substring(0, 55) + '\n')
      }
    }
  }

  console.log(`\nDone: ${totalShops} shops, ${totalListings} listings seeded.`)
  if (errors.length) {
    console.warn('\nErrors:')
    errors.forEach(e => console.warn(' ✗', e))
  }
}

main().catch(err => { console.error(err); process.exit(1) })
