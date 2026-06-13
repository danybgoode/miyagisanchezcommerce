/**
 * Pure, next-free helpers shared across the shop-settings sections. Moved
 * verbatim out of the ShopSettings monolith so they get free pure-logic spec
 * coverage and can be reused by extracted per-section components.
 */

import type { SettingsTree } from './types'

/** Split a stored "City, State" location string into its parts. */
export function parseLocation(loc: string | null): { city: string; state: string } {
  if (!loc) return { city: '', state: '' }
  const parts = loc.split(', ')
  if (parts.length >= 2) return { city: parts[0], state: parts.slice(1).join(', ') }
  return { city: '', state: parts[0] }
}

/** Friendly name for a scheduling link host (used to auto-label agenda links). */
export function detectSchedulingService(url: string): string {
  if (url.includes('cal.com'))              return 'Cal.com'
  if (url.includes('calendly.com'))         return 'Calendly'
  if (url.includes('acuityscheduling.com')) return 'Acuity'
  if (url.includes('tidycal.com'))          return 'TidyCal'
  if (url.includes('google.com/calendar'))  return 'Google Calendar'
  return 'Cita en línea'
}

/** Carriers offered through the Envia.com fulfillment provider (Envíos section). */
export const ENVIA_CARRIERS = [
  { id: 'dhl', label: 'DHL' },
  { id: 'fedex', label: 'FedEx' },
  { id: 'estafeta', label: 'Estafeta' },
  { id: 'ups', label: 'UPS' },
  { id: 'redpack', label: 'Redpack' },
  { id: 'paquetexpress', label: 'Paquetexpress' },
]

/** 32-byte hex secret (used to mint the agent webhook secret). */
export function generateHex32(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, '0')).join('')
}

// ── Store-type presets ────────────────────────────────────────────────────────

export interface Preset {
  key: string
  icon: string
  label: string
  description: string
  settings: SettingsTree
}

export const PRESETS: Preset[] = [
  {
    key: 'basico',
    icon: '🛒',
    label: 'Tienda general',
    description: 'Ropa, hogar, artículos del día a día. Sin retención de fondos.',
    settings: {
      checkout: { escrow_mode: 'off', show_phone: true, whatsapp_cta: true },
      shipping: { local_pickup: true },
    },
  },
  {
    key: 'protegido',
    icon: '🛡️',
    label: 'Con garantía',
    description: 'El comprador activa la protección si lo desea. Recomendado para electrónica usada.',
    settings: {
      checkout: { escrow_mode: 'optional', show_phone: true, whatsapp_cta: true },
      shipping: { local_pickup: true },
    },
  },
  {
    key: 'alto_valor',
    icon: '💎',
    label: 'Artículos de valor',
    description: 'Joyería, coleccionables, electrónica cara. Compra Protegida siempre activa.',
    settings: {
      checkout: { escrow_mode: 'required', show_phone: false, whatsapp_cta: false },
      shipping: { local_pickup: false },
    },
  },
  {
    key: 'vehiculos',
    icon: '🚗',
    label: 'Vehículos',
    description: 'Autos, motos, camiones. Pago protegido obligatorio + verificación REPUVE.',
    settings: {
      checkout: { escrow_mode: 'required', show_phone: true, whatsapp_cta: true },
      shipping: { local_pickup: true },
    },
  },
  {
    key: 'inmuebles',
    icon: '🏠',
    label: 'Inmuebles',
    description: 'Venta y renta de propiedades. Depósito protegido para reserva.',
    settings: {
      checkout: { escrow_mode: 'required', show_phone: true, whatsapp_cta: true },
      shipping: { local_pickup: true },
    },
  },
  {
    key: 'digital',
    icon: '💻',
    label: 'Digital / Cursos',
    description: 'Archivos, plantillas, cursos, licencias. Entrega automática.',
    settings: {
      checkout: { escrow_mode: 'off', show_phone: false, whatsapp_cta: false },
      shipping: { local_pickup: false },
    },
  },
]
