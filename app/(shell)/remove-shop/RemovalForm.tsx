'use client'

import { useState } from 'react'

export default function RemovalForm({ shopSlug, market, token }: { shopSlug: string; market: 'mx' | 'us'; token: string }) {
  const english = market === 'us'
  const [email, setEmail] = useState('')
  const [reason, setReason] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState('')
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setState('busy'); setMessage('')
    try {
      const res = await fetch('/api/shops/removal', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, email, reason }),
      })
      const data = await res.json() as { error?: string; requestId?: string }
      if (!res.ok) throw new Error(data.error ?? (english ? 'We could not submit the request.' : 'No pudimos enviar la solicitud.'))
      setState('done')
      setMessage(english
        ? `We received your request (${data.requestId}). The shop is offline while we verify the details with you.`
        : `Recibimos tu solicitud (${data.requestId}). La tienda está fuera de línea mientras verificamos los datos contigo.`)
    } catch (error) {
      setState('error')
      setMessage(error instanceof Error ? error.message : (english ? 'We could not submit the request.' : 'No pudimos enviar la solicitud.'))
    }
  }
  if (state === 'done') return <p className="mt-8 rounded-lg border p-5" role="status">{message}</p>
  return <form onSubmit={submit} className="mt-8 space-y-5">
    <p className="text-sm opacity-70">{english ? 'Shop' : 'Tienda'}: {shopSlug}</p>
    <label className="block">{english ? 'Email address where we can reach you' : 'Correo donde podemos contactarte'}<input required type="email" value={email} onChange={e => setEmail(e.target.value)} className="mt-1 block w-full rounded border p-2" /></label>
    <label className="block">{english ? 'Why you want it removed' : 'Por qué quieres retirarla'}<textarea required minLength={10} maxLength={2000} rows={4} value={reason} onChange={e => setReason(e.target.value)} className="mt-1 block w-full rounded border p-2" /></label>
    {state === 'error' && <p className="text-red-700" role="alert">{message}</p>}
    <button disabled={state === 'busy'} className="rounded bg-black px-5 py-3 text-white disabled:opacity-50">{state === 'busy' ? (english ? 'Sending…' : 'Enviando…') : (english ? 'Request removal' : 'Solicitar retiro')}</button>
  </form>
}
