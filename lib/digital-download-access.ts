export const PAID_DOWNLOAD_ORDER_STATUSES = [
  'paid',
  'processing',
  'shipped',
  'in_transit',
  'delivered',
  'completed',
  'fulfilled',
] as const

export type PaidDownloadOrderStatus = typeof PAID_DOWNLOAD_ORDER_STATUSES[number]

export interface DigitalDownloadActor {
  userId: string | null
  verifiedBuyerEmails: string[]
}

export interface DigitalDownloadOrderEvidence {
  id: string
  status: string | null
  buyerClerkUserId: string | null
  buyerEmail: string | null
  medusaOrderId: string | null
}

export interface DigitalDownloadAccess {
  allowed: boolean
  role: 'owner' | 'buyer' | null
  deniedStatus: 402 | null
}

export function normalizeBuyerEmails(emails: Array<string | null | undefined>): string[] {
  const unique = new Set<string>()
  for (const email of emails) {
    const clean = email?.trim()
    if (!clean) continue
    unique.add(clean)
    unique.add(clean.toLowerCase())
  }
  return [...unique]
}

export function isPaidDownloadStatus(status: unknown): status is PaidDownloadOrderStatus {
  return typeof status === 'string'
    && (PAID_DOWNLOAD_ORDER_STATUSES as readonly string[]).includes(status)
}

export function isClerkUserOrderEvidence(
  actor: DigitalDownloadActor,
  order: DigitalDownloadOrderEvidence,
): boolean {
  return !!actor.userId && order.buyerClerkUserId === actor.userId
}

export function isVerifiedEmailOrderEvidence(
  actor: DigitalDownloadActor,
  order: DigitalDownloadOrderEvidence,
): boolean {
  if (!order.medusaOrderId) return false
  const orderEmails = normalizeBuyerEmails([order.buyerEmail])
  return orderEmails.some(email => actor.verifiedBuyerEmails.includes(email))
}

export function resolveDigitalDownloadAccess({
  actor,
  ownerClerkUserId,
  paidOrder,
}: {
  actor: DigitalDownloadActor
  ownerClerkUserId: string | null | undefined
  paidOrder: DigitalDownloadOrderEvidence | null
}): DigitalDownloadAccess {
  if (actor.userId && ownerClerkUserId === actor.userId) {
    return { allowed: true, role: 'owner', deniedStatus: null }
  }

  if (
    paidOrder
    && isPaidDownloadStatus(paidOrder.status)
    && (
      isClerkUserOrderEvidence(actor, paidOrder)
      || isVerifiedEmailOrderEvidence(actor, paidOrder)
    )
  ) {
    return { allowed: true, role: 'buyer', deniedStatus: null }
  }

  return { allowed: false, role: null, deniedStatus: 402 }
}
