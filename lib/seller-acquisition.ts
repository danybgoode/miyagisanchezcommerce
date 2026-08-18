export type SellerPersonaId = 'vende' | 'creadores' | 'mundial' | 'negocios' | 'servicios' | 'autos'
export type SellerAcquisitionVariant = 'a' | 'b'

const UTM_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
] as const

const SELLER_ACQUISITION_VARIANTS = ['a', 'b'] as const
const SELLER_ACQUISITION_VARIANT_PARAM = 'v'

type QueryInput =
  | string
  | URLSearchParams
  | Record<string, string | string[] | undefined | null>
  | null
  | undefined

export type SellerAcquisitionUtm = Partial<Record<typeof UTM_KEYS[number], string>>

export type SellerPersonaRoute = {
  id: SellerPersonaId
  pagePath: string | null
  from: string
  type?: string
  status: 'live' | 'upcoming'
}

const MAX_UTM_VALUE_LENGTH = 140

export const SELLER_PERSONA_ROUTES: Record<SellerPersonaId, SellerPersonaRoute> = {
  vende: {
    id: 'vende',
    pagePath: '/vende',
    from: 'vende',
    status: 'live',
  },
  creadores: {
    id: 'creadores',
    pagePath: '/vende/creadores',
    from: 'creadores',
    status: 'live',
  },
  mundial: {
    id: 'mundial',
    pagePath: '/vende/mundial',
    from: 'mundial',
    type: 'service',
    status: 'live',
  },
  negocios: {
    id: 'negocios',
    pagePath: '/vende/negocios',
    from: 'negocios',
    status: 'live',
  },
  servicios: {
    id: 'servicios',
    pagePath: '/vende/servicios',
    from: 'servicios',
    type: 'service',
    status: 'live',
  },
  autos: {
    id: 'autos',
    pagePath: '/vende/autos',
    from: 'autos',
    status: 'live',
  },
}

export function resolveSellerPersonaRoute(id: SellerPersonaId): SellerPersonaRoute {
  return SELLER_PERSONA_ROUTES[id]
}

const SELLER_ACQUISITION_BASE_URL = 'https://miyagisanchez.com'

/**
 * Builds the directive "ask your AI" prompt for a persona page by substituting the page's
 * own absolute URL into the shared `{url}` template. One base prompt, the URL swaps per page
 * so the visitor's agent reads the most relevant landing page when it evaluates the offer.
 */
export function sellerTrustPrompt(id: SellerPersonaId, template: string): string {
  const route = resolveSellerPersonaRoute(id)
  const url = `${SELLER_ACQUISITION_BASE_URL}${route.pagePath ?? '/vende'}`
  return template.replaceAll('{url}', url)
}

export function parseSellerAcquisitionUtm(input?: QueryInput): SellerAcquisitionUtm {
  const params = toSearchParams(input)
  const utm: SellerAcquisitionUtm = {}

  for (const key of UTM_KEYS) {
    const value = sanitizeUtmValue(params.get(key))
    if (value) {
      utm[key] = value
    }
  }

  return utm
}

export function resolveSellerAcquisitionVariant(input?: QueryInput): SellerAcquisitionVariant {
  return readSellerAcquisitionVariant(input)?.variant ?? 'a'
}

export function sellerPersonaCtaHref(id: SellerPersonaId, input?: QueryInput): string {
  const route = resolveSellerPersonaRoute(id)
  return buildSellHref(route.from, input, route.type)
}

/**
 * The US recruiting CTA — the `/sell` signed-out landing's primary and closing
 * buttons.
 *
 * Same convert-on-`/sign-up` shape as the MX personas, with one addition: the
 * publish destination carries `market=us`, because a shop's market is IMMUTABLE
 * after creation (us-marketplace S5.2 · D17) and the signup request is the only
 * moment it can be set. `resolveSellerSignupMarket` is the validator that reads
 * it — this function only has to make sure the parameter survives the trip
 * through account creation, which is exactly what `redirect_url` buys.
 */
export function usSellerCtaHref(input?: QueryInput): string {
  const params = new URLSearchParams()
  params.set('market', 'us')
  params.set('from', 'us')
  params.set(SELLER_ACQUISITION_VARIANT_PARAM, resolveSellerAcquisitionVariant(input))

  const utm = parseSellerAcquisitionUtm(input)
  for (const key of UTM_KEYS) {
    const value = utm[key]
    if (value) {
      params.set(key, value)
    }
  }

  return `${SELLER_SIGNUP_PATH}?redirect_url=${encodeURIComponent(`/sell?${params.toString()}`)}`
}

export function sellerPersonaRouterHref(id: SellerPersonaId, input?: QueryInput): string {
  const route = resolveSellerPersonaRoute(id)

  if (!route.pagePath) {
    return buildSellHref(route.from, input, route.type)
  }

  const utm = parseSellerAcquisitionUtm(input)
  const params = new URLSearchParams(utm)
  const explicitVariant = readSellerAcquisitionVariant(input)
  if (explicitVariant?.explicit) {
    params.set(SELLER_ACQUISITION_VARIANT_PARAM, explicitVariant.variant)
  }

  const qs = params.toString()
  return qs ? `${route.pagePath}?${qs}` : route.pagePath
}

export const SELLER_SIGNUP_PATH = '/sign-up'

/**
 * The publish destination a converted visitor lands on *after* creating their
 * account. This is what the CTA used to point at directly.
 */
function buildPublishHref(from: string, input?: QueryInput, type?: string): string {
  const params = new URLSearchParams()
  if (type) {
    params.set('type', type)
  }
  params.set('from', from)
  params.set(SELLER_ACQUISITION_VARIANT_PARAM, resolveSellerAcquisitionVariant(input))

  const utm = parseSellerAcquisitionUtm(input)
  for (const key of UTM_KEYS) {
    const value = utm[key]
    if (value) {
      params.set(key, value)
    }
  }

  return `/sell?${params.toString()}`
}

/**
 * The seller-acquisition CTA target: account creation FIRST, then the wizard.
 *
 * A visitor cannot publish without an account, so `/sell` used to greet them
 * with a second, thinner marketing page before handing them to `/sign-up`
 * anyway. Sending them straight to `/sign-up` removes that speed bump.
 *
 * Attribution — the persona `from`, the A/B `v` variant and every sanitized UTM
 * — is preserved INSIDE `redirect_url` rather than on `/sign-up` itself. Clerk
 * carries that parameter through its hosted flow and drops the new seller on
 * the wizard with exactly the query the CTA would have delivered pre-signup, so
 * variant reporting and UTM attribution are unbroken. `redirect_url` is the same
 * parameter the buyer sign-in CTAs already use, and a component-level
 * `signUpFallbackRedirectUrl` applies only when it is ABSENT — so the two never
 * fight (see MarketDocument.tsx: fallback, never force).
 */
function buildSellHref(from: string, input?: QueryInput, type?: string): string {
  const publishHref = buildPublishHref(from, input, type)
  return `${SELLER_SIGNUP_PATH}?redirect_url=${encodeURIComponent(publishHref)}`
}

function readSellerAcquisitionVariant(input?: QueryInput): {
  variant: SellerAcquisitionVariant
  explicit: boolean
} | null {
  const params = toSearchParams(input)
  const raw = params.get(SELLER_ACQUISITION_VARIANT_PARAM) ?? params.get('variant')
  const value = raw?.trim().toLowerCase()

  if (SELLER_ACQUISITION_VARIANTS.includes(value as SellerAcquisitionVariant)) {
    return { variant: value as SellerAcquisitionVariant, explicit: true }
  }

  return null
}

function toSearchParams(input?: QueryInput): URLSearchParams {
  if (!input) {
    return new URLSearchParams()
  }

  if (typeof input === 'string') {
    return new URLSearchParams(input.startsWith('?') ? input.slice(1) : input)
  }

  if (input instanceof URLSearchParams) {
    return input
  }

  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(input)) {
    const first = Array.isArray(value) ? value[0] : value
    if (typeof first === 'string') {
      params.set(key, first)
    }
  }
  return params
}

function sanitizeUtmValue(value: string | null): string | null {
  const clean = value?.trim()
  if (!clean) {
    return null
  }
  return clean.slice(0, MAX_UTM_VALUE_LENGTH)
}
