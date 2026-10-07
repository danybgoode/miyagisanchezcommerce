'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { CONTACT_EMAIL } from '@/lib/contact'
import { useRouter } from 'next/navigation'

export default function ClaimRedeemer({ token, market }: { token: string; market: 'mx' | 'us' }) {
  const english = market === 'us'
  const router = useRouter()
  const started = useRef(false)
  const [state, setState] = useState<'working' | 'done' | 'error'>('working')
  const [message, setMessage] = useState(english ? 'Checking your shop link…' : 'Estamos verificando tu enlace…')
  useEffect(() => {
    if (started.current) return
    started.current = true
    void (async () => {
      try {
        const res = await fetch('/api/claim/complete', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        })
        const data = await res.json() as { error?: string }
        if (!res.ok) throw new Error(english
          ? res.status === 409 || res.status === 404 ? 'This shop is no longer available to claim.' : 'We could not finish the claim. Please try again.'
          : data.error ?? 'No pudimos terminar la reclamación.')
        setState('done')
        setMessage(english ? 'The shop is now linked to your account.' : 'La tienda ya está vinculada a tu cuenta.')
        router.replace('/shop/manage')
      } catch (error) {
        setState('error')
        setMessage(error instanceof Error ? error.message : (english ? 'We could not finish the claim.' : 'No pudimos terminar la reclamación.'))
      }
    })()
  }, [token, router, english])
  return <div className="mt-8 rounded-lg border p-5" role="status">
    <p>{message}</p>
    {state === 'done' && <Link className="mt-4 inline-block underline" href="/shop/manage">{english ? 'Manage my shop' : 'Administrar mi tienda'}</Link>}
    {state === 'error' && <p className="mt-4">{english ? 'Need help? Reply to the invitation or ' : 'Si necesitas ayuda, responde a la invitación o '}<a className="underline" href={`mailto:${CONTACT_EMAIL}`}>{english ? 'write to us' : 'escríbenos'}</a>.</p>}
  </div>
}
