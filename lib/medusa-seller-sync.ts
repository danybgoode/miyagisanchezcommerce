const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const PUB_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

export async function syncMedusaSellerProfile(
  clerkJwt: string | null | undefined,
  payload: Record<string, unknown>,
) {
  if (!clerkJwt || Object.keys(payload).length === 0) return

  const res = await fetch(`${MEDUSA_BASE}/store/sellers/me`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'x-publishable-api-key': PUB_KEY,
      Authorization: `Bearer ${clerkJwt}`,
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    throw new Error(`Medusa seller sync failed: ${res.status} ${await res.text()}`)
  }
}
