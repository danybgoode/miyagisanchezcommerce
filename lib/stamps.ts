// ── Structured communication stamps ──────────────────────────────────────────
// No free text — stamps are typed events readable by agents and humans alike.
// Each stamp has a role (buyer/seller/both) and a display text in Spanish.

export const STAMPS = {
  // ── Buyer stamps ──────────────────────────────────────────────────────────
  buyer_still_available:  { role: 'buyer',  text: '¿Sigue disponible?' },
  buyer_more_photos:      { role: 'buyer',  text: '¿Tienes más fotos?' },
  buyer_includes_shipping:{ role: 'buyer',  text: '¿Incluye envío?' },
  buyer_meetup_location:  { role: 'buyer',  text: '¿Dónde hacemos el intercambio?' },
  buyer_lower_price:      { role: 'buyer',  text: '¿Aceptas un poco menos?' },
  buyer_bundle_discount:  { role: 'buyer',  text: '¿Descuento si compro más de uno?' },
  buyer_when_deliver:     { role: 'buyer',  text: '¿Cuándo puedes entregar?' },
  buyer_send_agent:       { role: 'buyer',  text: 'Mi agente negociará por mí' },

  // ── Seller stamps ─────────────────────────────────────────────────────────
  seller_price_is_firm:   { role: 'seller', text: 'El precio es fijo' },
  seller_min_price:       { role: 'seller', text: 'Precio mínimo alcanzado' },
  seller_photos_sent:     { role: 'seller', text: 'Fotos adicionales enviadas' },
  seller_meetup_cdmx:     { role: 'seller', text: 'Disponible para meetup en CDMX' },
  seller_ships_nationwide:{ role: 'seller', text: 'Envío a todo México disponible' },
  seller_available_week:  { role: 'seller', text: 'Disponible esta semana' },
  seller_accept_offer:    { role: 'seller', text: '¡Trato hecho, acepto tu oferta!' },
  seller_send_agent:      { role: 'seller', text: 'Mi agente atiende esta oferta' },
} as const

export type StampKey = keyof typeof STAMPS

export type Stamp = (typeof STAMPS)[StampKey]

export const BUYER_STAMPS = (Object.entries(STAMPS) as Array<[StampKey, Stamp]>)
  .filter(([, v]) => (v.role as string) === 'buyer' || (v.role as string) === 'both')
  .map(([key, v]) => ({ key, text: v.text }))

export const SELLER_STAMPS = (Object.entries(STAMPS) as Array<[StampKey, Stamp]>)
  .filter(([, v]) => (v.role as string) === 'seller' || (v.role as string) === 'both')
  .map(([key, v]) => ({ key, text: v.text }))
