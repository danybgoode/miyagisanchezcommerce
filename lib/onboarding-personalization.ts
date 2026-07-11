/**
 * Onboarding three-doors — pure intake→personalization mapping (Sprint 1,
 * Story 1.1/1.2). No React/DOM, no `next/*` — so the api spec
 * (`e2e/onboarding-three-doors.spec.ts`) can load it directly, same
 * discipline as `lib/seller-mode.ts`/`lib/sell-shell-path.ts`.
 *
 * `TenantIntake` is the shared intake shape; `lib/tenant-intake.ts` (the
 * DB-touching module) imports it from here rather than the reverse, so this
 * file stays free of any Supabase/next import.
 */

/** Mirrors `SellWizard`'s 5 listing types (Q1 "¿Qué vendes?"). */
export const SELLS_OPTIONS = ['product', 'service', 'rental', 'digital', 'subscription'] as const
export type SellsOption = typeof SELLS_OPTIONS[number]

/** Q2 "¿Dónde vendes hoy?" chip values. */
export const SELLS_WHERE_OPTIONS = [
  'mercado_libre',
  'instagram_facebook',
  'whatsapp',
  'tienda_fisica',
  'sin_vender',
] as const
export type SellsWhereOption = typeof SELLS_WHERE_OPTIONS[number]

export interface TenantIntake {
  sells: SellsOption[]
  sellsWhere: SellsWhereOption[]
}

export type DoorKey = 'agent' | 'import' | 'wizard'

export interface DoorPersonalization {
  order: DoorKey[]
  subtitle: string
}

const DEFAULT_SUBTITLE = 'Elige cómo armar tu tienda — puedes cambiar de camino cuando quieras.'
const ML_SUBTITLE = 'Como ya vendes en Mercado Libre, podemos traer tu catálogo casi solo.'
const EXISTING_CHANNEL_SUBTITLE = 'Ya vendes en otro lado — te ayudamos a traer lo que ya tienes.'

/**
 * "Where do you sell today" answers that mean a real existing channel (not
 * "aún no vendo"). Exported so `lib/setup-guide.ts`'s S6 step-personalization
 * (Sprint 2) reuses the exact same "existing channel" signal as door-ranking
 * above, rather than defining a second, driftable copy.
 */
export const EXISTING_CHANNELS: readonly SellsWhereOption[] = ['mercado_libre', 'instagram_facebook', 'whatsapp', 'tienda_fisica']

/**
 * Door 1 (agent) is always first/recommended, unconditionally. Door 2
 * (import) ranks above Door 3 (wizard) when the merchant already sells
 * somewhere (an existing catalog is more likely to exist to import); Door 3
 * ranks above Door 2 otherwise (nothing to import yet, so building by hand
 * is the more direct path). No intake at all → the same default order a
 * merchant who skipped intake would see.
 */
export function personalizeDoors(intake: TenantIntake | null): DoorPersonalization {
  if (!intake || intake.sellsWhere.length === 0) {
    return { order: ['agent', 'wizard', 'import'], subtitle: DEFAULT_SUBTITLE }
  }

  const hasExistingChannel = intake.sellsWhere.some((w) => EXISTING_CHANNELS.includes(w))
  if (!hasExistingChannel) {
    return { order: ['agent', 'wizard', 'import'], subtitle: DEFAULT_SUBTITLE }
  }

  const subtitle = intake.sellsWhere.includes('mercado_libre') ? ML_SUBTITLE : EXISTING_CHANNEL_SUBTITLE
  return { order: ['agent', 'import', 'wizard'], subtitle }
}
