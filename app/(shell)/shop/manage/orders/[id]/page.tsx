import { notFound, redirect } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import OrderDetail from './OrderDetail'

export const metadata = { title: 'Detalle de pedido — Miyagi Sánchez' }

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const MEDUSA_PUB_KEY = process.env.MEDUSA_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const { userId, getToken } = await auth()
  if (!userId) redirect('/sign-in')

  const clerkJwt = await getToken()
  if (!clerkJwt) redirect('/sign-in')

  // All seller orders now routed by Medusa order ID
  const res = await fetch(`${MEDUSA_BASE}/store/sellers/me/orders/${id}`, {
    headers: {
      'x-publishable-api-key': MEDUSA_PUB_KEY,
      Authorization: `Bearer ${clerkJwt}`,
    },
    cache: 'no-store',
  })

  if (!res.ok) notFound()

  const { order } = await res.json() as { order: Parameters<typeof OrderDetail>[0]['order'] }
  if (!order) notFound()

  return <OrderDetail order={order} />
}
