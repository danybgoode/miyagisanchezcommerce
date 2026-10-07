export interface ClaimPayload {
  shopId: string
  shopSlug: string
  shopName: string
  email: string
  /** Missing on legacy emails, which now require human review. */
  purpose?: 'campaign' | 'promoter' | 'public' | 'removal'
  market?: 'mx' | 'us'
  campaignId?: string
  invitationId?: string
  iat: number
  exp: number
}

function base64url(buf: ArrayBuffer): string {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function base64urlFromString(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

async function getKey(): Promise<CryptoKey> {
  const secret = process.env.CLAIM_JWT_SECRET!
  const keyData = new TextEncoder().encode(secret)
  return crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )
}

export async function signClaimToken(
  payload: Omit<ClaimPayload, 'iat' | 'exp'>,
  ttlSeconds = 24 * 60 * 60,
): Promise<string> {
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 14 * 24 * 60 * 60) {
    throw new Error('Invalid claim token lifetime')
  }
  const now = Math.floor(Date.now() / 1000)
  const fullPayload: ClaimPayload = {
    ...payload,
    iat: now,
    exp: now + ttlSeconds,
  }

  const header = base64urlFromString(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = base64urlFromString(JSON.stringify(fullPayload))
  const sigInput = new TextEncoder().encode(`${header}.${body}`)

  const key = await getKey()
  const sigBuf = await crypto.subtle.sign('HMAC', key, sigInput)
  const sig = base64url(sigBuf)

  return `${header}.${body}.${sig}`
}

export async function verifyClaimToken(token: string): Promise<ClaimPayload> {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('Malformed token')

  const [header, body, sig] = parts
  const sigInput = new TextEncoder().encode(`${header}.${body}`)

  const key = await getKey()
  const sigBuf = Buffer.from(sig.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  const valid = await crypto.subtle.verify('HMAC', key, sigBuf, sigInput)
  if (!valid) throw new Error('Invalid signature')

  const payload = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()) as ClaimPayload
  const now = Math.floor(Date.now() / 1000)
  if (!Number.isSafeInteger(payload.exp) || payload.exp <= now) throw new Error('Token expired')

  return payload
}
