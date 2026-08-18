export type WaitingOrder = { created_at: string }

export function oldestWaitingOrderAgeMs(orders: WaitingOrder[], now = Date.now()): number | null {
  const timestamps = orders
    .map((order) => new Date(order.created_at).getTime())
    .filter(Number.isFinite)
  if (timestamps.length === 0) return null
  return Math.max(0, now - Math.min(...timestamps))
}

export function formatWaitingOrderUrgency(orders: WaitingOrder[], now = Date.now()): string {
  const ageMs = oldestWaitingOrderAgeMs(orders, now)
  if (ageMs === null) return 'Revisa cada pedido cuando llegue y mantén su estado actualizado.'
  const minutes = Math.max(1, Math.floor(ageMs / 60_000))
  if (minutes < 60) return `El pedido más antiguo lleva ${minutes} min esperando una actualización.`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `El pedido más antiguo lleva ${hours} h esperando una actualización.`
  const days = Math.floor(hours / 24)
  return `El pedido más antiguo lleva ${days} día${days === 1 ? '' : 's'} esperando una actualización.`
}
