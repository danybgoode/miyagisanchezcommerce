export type SupportVisibility = 'public' | 'private'

export interface SupportSettings {
  enabled: boolean
  preset_amount_cents: number[]
  custom_min_cents: number
  custom_max_cents: number
  currency: string
  default_visibility: SupportVisibility
  support_product_id?: string | null
}

export const DEFAULT_SUPPORT_SETTINGS: SupportSettings = {
  enabled: false,
  preset_amount_cents: [5000, 10000, 20000],
  custom_min_cents: 2000,
  custom_max_cents: 500000,
  currency: 'MXN',
  default_visibility: 'public',
  support_product_id: null,
}

function amountCents(value: unknown): number | null {
  const n = Math.round(Number(value))
  return Number.isFinite(n) && n > 0 ? n : null
}

export function normalizeSupportSettings(input: unknown):
  | { ok: true; settings: SupportSettings }
  | { ok: false; field: string; error: string } {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const enabled = raw.enabled === true

  const presets = Array.isArray(raw.preset_amount_cents)
    ? raw.preset_amount_cents.map(amountCents).filter((v): v is number => v != null)
    : DEFAULT_SUPPORT_SETTINGS.preset_amount_cents

  if (presets.length !== 3) {
    return { ok: false, field: 'support', error: 'Configura exactamente tres montos de apoyo.' }
  }

  const min = amountCents(raw.custom_min_cents) ?? DEFAULT_SUPPORT_SETTINGS.custom_min_cents
  const max = amountCents(raw.custom_max_cents) ?? DEFAULT_SUPPORT_SETTINGS.custom_max_cents
  if (min < 100) {
    return { ok: false, field: 'support', error: 'El monto mínimo debe ser de al menos $1 MXN.' }
  }
  if (max > 500000) {
    return { ok: false, field: 'support', error: 'El monto máximo no puede superar $5,000 MXN.' }
  }
  if (min > max) {
    return { ok: false, field: 'support', error: 'El mínimo de apoyo no puede ser mayor que el máximo.' }
  }
  if (presets.some((amount) => amount < min || amount > max)) {
    return { ok: false, field: 'support', error: 'Los tres montos sugeridos deben estar dentro del rango permitido.' }
  }

  const currency = String(raw.currency ?? DEFAULT_SUPPORT_SETTINGS.currency).trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) {
    return { ok: false, field: 'support', error: 'La moneda de apoyos no es válida.' }
  }

  return {
    ok: true,
    settings: {
      enabled,
      preset_amount_cents: presets,
      custom_min_cents: min,
      custom_max_cents: max,
      currency,
      default_visibility: raw.default_visibility === 'private' ? 'private' : 'public',
      support_product_id: typeof raw.support_product_id === 'string' && raw.support_product_id
        ? raw.support_product_id
        : null,
    },
  }
}

export function coerceSupportSettings(input: unknown): SupportSettings {
  const normalized = normalizeSupportSettings(input)
  return normalized.ok ? normalized.settings : DEFAULT_SUPPORT_SETTINGS
}

export function validateSupportContribution(settings: SupportSettings, amountCentsValue: unknown, message: unknown) {
  const amount = amountCents(amountCentsValue)
  if (!amount || amount < settings.custom_min_cents || amount > settings.custom_max_cents) {
    return { ok: false as const, error: 'El monto está fuera del rango permitido.' }
  }
  const text = typeof message === 'string' ? message.trim() : ''
  if (text.length > 250) {
    return { ok: false as const, error: 'El mensaje no puede superar 250 caracteres.' }
  }
  return { ok: true as const, amount_cents: amount, message: text || null }
}
