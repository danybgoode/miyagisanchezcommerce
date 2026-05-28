// ── Structured communication stamps ──────────────────────────────────────────
// No free text — stamps are typed events readable by agents and humans alike.
// Each stamp has a role (buyer/seller/both) and a display text in Spanish.

export const STAMPS = {
  // ── Buyer: availability & info ────────────────────────────────────────────
  buyer_still_available:   { role: 'buyer', text: '¿Sigue disponible?' },
  buyer_more_photos:       { role: 'buyer', text: '¿Tienes más fotos?' },
  buyer_condition_question:{ role: 'buyer', text: '¿En qué condición está?' },
  buyer_dimensions:        { role: 'buyer', text: '¿Cuáles son las medidas?' },
  buyer_includes_shipping: { role: 'buyer', text: '¿Incluye envío?' },
  buyer_meetup_location:   { role: 'buyer', text: '¿Dónde hacemos el intercambio?' },

  // ── Buyer: price & payment ────────────────────────────────────────────────
  buyer_lower_price:       { role: 'buyer', text: '¿Aceptas un poco menos?' },
  buyer_bundle_discount:   { role: 'buyer', text: '¿Descuento si compro más de uno?' },
  buyer_price_question:    { role: 'buyer', text: '¿Cuál es el precio?' },
  buyer_ready_to_pay:      { role: 'buyer', text: 'Listo para pagar ahora' },

  // ── Buyer: delivery ───────────────────────────────────────────────────────
  buyer_when_deliver:      { role: 'buyer', text: '¿Cuándo puedes entregar?' },
  buyer_need_today:        { role: 'buyer', text: 'Necesito para hoy' },
  buyer_need_this_week:    { role: 'buyer', text: 'Necesito esta semana' },

  // ── Buyer: agents ─────────────────────────────────────────────────────────
  buyer_send_agent:        { role: 'buyer', text: 'Mi agente negociará por mí' },

  // ── Seller: availability ──────────────────────────────────────────────────
  seller_confirm_available:{ role: 'seller', text: 'Sí, sigue disponible' },
  seller_no_longer_avail:  { role: 'seller', text: 'Ya no está disponible' },
  seller_photos_sent:      { role: 'seller', text: 'Fotos adicionales enviadas' },

  // ── Seller: delivery timing ───────────────────────────────────────────────
  seller_available_today:  { role: 'seller', text: 'Puedo entregar hoy mismo' },
  seller_available_tomorrow:{ role: 'seller', text: 'Puedo entregar mañana' },
  seller_delivery_2_3_days:{ role: 'seller', text: 'Entrego en 2-3 días hábiles' },
  seller_available_week:   { role: 'seller', text: 'Entrego esta semana' },
  seller_delivery_next_week:{ role: 'seller', text: 'Entrego la próxima semana' },

  // ── Seller: shipping & location ───────────────────────────────────────────
  seller_ships_nationwide: { role: 'seller', text: 'Envío a todo México disponible' },
  seller_local_pickup_only:{ role: 'seller', text: 'Solo entrega en mano / meetup' },
  seller_meetup_cdmx:      { role: 'seller', text: 'Disponible para meetup en CDMX' },

  // ── Seller: price ─────────────────────────────────────────────────────────
  seller_price_is_firm:    { role: 'seller', text: 'El precio es fijo' },
  seller_min_price:        { role: 'seller', text: 'Precio mínimo alcanzado' },
  seller_accept_offer:     { role: 'seller', text: '¡Trato hecho, acepto tu oferta!' },

  // ── Seller: agents ────────────────────────────────────────────────────────
  seller_send_agent:       { role: 'seller', text: 'Mi agente atiende esta oferta' },
} as const

export type StampKey = keyof typeof STAMPS

export type Stamp = (typeof STAMPS)[StampKey]

export const BUYER_STAMPS = (Object.entries(STAMPS) as Array<[StampKey, Stamp]>)
  .filter(([, v]) => (v.role as string) === 'buyer' || (v.role as string) === 'both')
  .map(([key, v]) => ({ key, text: v.text }))

export const SELLER_STAMPS = (Object.entries(STAMPS) as Array<[StampKey, Stamp]>)
  .filter(([, v]) => (v.role as string) === 'seller' || (v.role as string) === 'both')
  .map(([key, v]) => ({ key, text: v.text }))
