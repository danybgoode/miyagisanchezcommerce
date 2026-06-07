export type SellerPersonaId = 'vende' | 'creadores' | 'mundial' | 'negocios' | 'servicios'

const UTM_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
] as const

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
}

export function resolveSellerPersonaRoute(id: SellerPersonaId): SellerPersonaRoute {
  return SELLER_PERSONA_ROUTES[id]
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

export function sellerPersonaCtaHref(id: SellerPersonaId, input?: QueryInput): string {
  const route = resolveSellerPersonaRoute(id)
  return buildSellHref(route.from, input, route.type)
}

export function sellerPersonaRouterHref(id: SellerPersonaId, input?: QueryInput): string {
  const route = resolveSellerPersonaRoute(id)

  if (!route.pagePath) {
    return buildSellHref(route.from, input, route.type)
  }

  const utm = parseSellerAcquisitionUtm(input)
  const params = new URLSearchParams(utm)
  const qs = params.toString()
  return qs ? `${route.pagePath}?${qs}` : route.pagePath
}

function buildSellHref(from: string, input?: QueryInput, type?: string): string {
  const params = new URLSearchParams()
  if (type) {
    params.set('type', type)
  }
  params.set('from', from)

  const utm = parseSellerAcquisitionUtm(input)
  for (const key of UTM_KEYS) {
    const value = utm[key]
    if (value) {
      params.set(key, value)
    }
  }

  return `/sell?${params.toString()}`
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
