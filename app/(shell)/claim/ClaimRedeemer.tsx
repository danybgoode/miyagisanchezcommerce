'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { CONTACT_EMAIL } from '@/lib/contact'
import { useRouter } from 'next/navigation'

export default function ClaimRedeemer({ token }: { token: string }) {
  const router = useRouter()
  const started = useRef(false)
  const [state, setState] = useState<'working' | 'done' | 'error'>('working')
  const [message, setMessage] = useState('Estamos verificando tu invitación…')
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
        if (!res.ok) throw new Error(data.error ?? 'No pudimos terminar la reclamación.')
        setState('done')
        setMessage('La tienda ya está vinculada a tu cuenta.')
        router.replace('/shop/manage')
      } catch (error) {
        setState('error')
        setMessage(error instanceof Error ? error.message : 'No pudimos terminar la reclamación.')
      }
    })()
  }, [token, router])
  return <div className="mt-8 rounded-lg border p-5" role="status">
    <p>{message}</p>
    {state === 'done' && <Link className="mt-4 inline-block underline" href="/shop/manage">Administrar mi tienda</Link>}
    {state === 'error' && <p className="mt-4">Si necesitas ayuda, responde a la invitación o <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>escríbenos</a>.</p>}
  </div>
}
