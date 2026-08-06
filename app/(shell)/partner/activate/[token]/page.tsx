import { currentUser } from '@clerk/nextjs/server'
import { notFound, redirect } from 'next/navigation'
import { recruitingV3Enabled } from '@/lib/recruiting-v3'
import { inspectFoundingOperatorActivation } from '@/lib/founding-operator-activation'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Activate Miyagi Partners', robots: { index: false } }

export default async function FoundingOperatorActivationPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ status?: string | string[] }>
}) {
  if (!(await recruitingV3Enabled())) notFound()
  const { token } = await params
  const state = await inspectFoundingOperatorActivation(token)
  const rawStatus = (await searchParams).status
  const status = Array.isArray(rawStatus) ? rawStatus[0] : rawStatus
  if (state === 'ready') {
    const user = await currentUser()
    if (!user) {
      redirect(`/sign-in?redirect_url=${encodeURIComponent(`/partner/activate/${token}`)}`)
    }
    return (
      <main className="mx-auto max-w-xl px-4 py-16">
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--accent)]">Miyagi Partners · identity activation</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight">Link your approved operator identity.</h1>
        <p className="mt-5 leading-7 text-[var(--fg-muted)]">
          This links the approved Founding Commerce Operator invitation to your signed-in Miyagi account.
          It creates no shop, contacts no merchant, and grants access to no shop.
        </p>
        {status === 'invalid' && (
          <p role="alert" className="mt-6 border-l-4 border-[var(--danger)] bg-[var(--danger-soft)] p-4 text-sm">
            This account could not activate the invitation. Use the Miyagi account whose verified email received it.
          </p>
        )}
        <form action={`/api/partner/activate/${token}`} method="post" className="mt-8">
          <button type="submit" className="btn btn-primary min-h-12 px-6">Activate Miyagi Partners</button>
        </form>
        <p className="mt-4 text-xs text-[var(--fg-muted)]">Program approval and shop permission are separate. Shops appear only after an active merchant/admin grant.</p>
      </main>
    )
  }

  const message = state === 'used'
    ? 'This invitation has already been activated.'
    : state === 'expired'
      ? 'This invitation has expired. Ask Miyagi to rotate and resend it.'
      : state === 'unavailable'
        ? 'We could not check this invitation right now. Try again in a moment.'
      : 'This activation invitation is not available.'
  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--accent)]">Miyagi Partners</p>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">Activation unavailable.</h1>
      <p className="mt-5 leading-7 text-[var(--fg-muted)]">{message}</p>
    </main>
  )
}
