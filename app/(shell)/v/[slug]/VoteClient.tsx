'use client'

import Link from 'next/link'
import { useState } from 'react'

/**
 * Bookshop launchpad · Sprint 3.2 — the public voting page (client). es-MX only.
 * Two-step email-code flow (send code → confirm vote), one vote per work. Live
 * progress is the honest server count, refreshed after each vote.
 */

export interface CampaignWorkView {
  productId: string
  title: string
  image: string | null
  href: string
  excerptSnippet: string | null
  hasMoreExcerpt: boolean
}

interface Props {
  slug: string
  title: string
  description: string | null
  terms: string | null
  threshold: number
  voteCount: number
  rewardPercent: number
  endsAt: string | null
  status: 'draft' | 'active' | 'closed_met' | 'closed_unmet' | 'cancelled'
  open: boolean
  works: CampaignWorkView[]
  shopName: string | null
  shopUrl: string | null
}

type Stage = 'idle' | 'code_sent' | 'voted'

export default function VoteClient(props: Props) {
  const [voteCount, setVoteCount] = useState(props.voteCount)
  const [thresholdReached, setThresholdReached] = useState(props.voteCount >= props.threshold && props.threshold > 0)
  const [activeWork, setActiveWork] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [stage, setStage] = useState<Stage>('idle')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const pct = props.threshold > 0 ? Math.min(100, Math.round((voteCount / props.threshold) * 100)) : 0

  const startVote = (productId: string) => {
    setActiveWork(productId); setStage('idle'); setError(null); setNotice(null); setCode('')
  }

  const sendCode = async () => {
    setBusy(true); setError(null); setNotice(null)
    try {
      const res = await fetch(`/api/launchpad/campaigns/${props.slug}/verification`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(codeError(data.error)); return }
      setStage('code_sent')
      setNotice('Te enviamos un código a tu correo. Revísalo (y la carpeta de spam).')
    } finally { setBusy(false) }
  }

  const confirmVote = async () => {
    if (!activeWork) return
    setBusy(true); setError(null); setNotice(null)
    try {
      const res = await fetch(`/api/launchpad/campaigns/${props.slug}/vote`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ work_product_id: activeWork, email, code }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error ?? 'No se pudo registrar tu voto.'); return }
      setVoteCount(data.vote_count ?? voteCount)
      setThresholdReached(!!data.threshold_reached)
      setStage('voted')
      setNotice(data.already_voted
        ? 'Ya habías votado por esta obra. ¡Gracias!'
        : '¡Tu voto quedó registrado! Gracias por participar.')
      setEmail(''); setCode(''); setActiveWork(null)
    } finally { setBusy(false) }
  }

  return (
    <main className="min-h-screen px-4 py-10 bg-[var(--color-background)]">
      <div className="max-w-2xl mx-auto">
        <Link href="/" className="text-xs text-[var(--color-muted)] no-underline hover:underline">miyagisanchez.com</Link>
        <h1 className="mt-3 text-2xl font-bold">{props.title}</h1>
        {props.shopName && (
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            {props.shopUrl ? <Link href={props.shopUrl} className="hover:underline">{props.shopName}</Link> : props.shopName}
          </p>
        )}
        {props.description && <p className="mt-4 text-[15px] leading-relaxed">{props.description}</p>}

        {/* Progress toward the threshold — honest server count. */}
        <div style={{ marginTop: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
            <span>{voteCount}/{props.threshold} votos</span>
            <span>{props.rewardPercent}% de descuento al llegar a la meta</span>
          </div>
          <div style={{ height: 12, background: 'var(--color-border)', borderRadius: 999, overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: thresholdReached ? 'var(--color-success)' : 'var(--color-info)', transition: 'width .3s' }} />
          </div>
          {thresholdReached && (
            <p style={{ marginTop: 8, color: 'var(--color-success)', fontSize: 14, fontWeight: 600 }}>
              🎉 ¡Se alcanzó la meta! Quien votó recibirá el cupón de impresión por correo.
            </p>
          )}
          {props.open && props.endsAt && (
            <p style={{ marginTop: 8, color: 'var(--color-muted)', fontSize: 12 }}>
              Cierra el {new Date(props.endsAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          )}
        </div>

        {props.status === 'closed_unmet' && (
          <p style={{ marginTop: 16, color: 'var(--color-danger)', fontSize: 14 }}>Esta campaña cerró sin alcanzar la meta. ¡Gracias a quienes participaron!</p>
        )}
        {props.status === 'cancelled' && (
          <p style={{ marginTop: 16, color: 'var(--color-muted)', fontSize: 14 }}>Esta campaña fue cancelada.</p>
        )}

        {(notice || error) && (
          <div role="status" style={{ marginTop: 16, padding: 12, borderRadius: 8, fontSize: 14, background: error ? 'var(--color-danger-soft)' : 'var(--color-success-soft)', color: error ? 'var(--color-danger)' : 'var(--color-success)' }}>
            {error ?? notice}
          </div>
        )}

        {/* Candidate works */}
        <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {props.works.map((w) => (
            <div key={w.productId} style={{ border: '1px solid var(--color-border)', borderRadius: 12, padding: 16 }}>
              <div style={{ display: 'flex', gap: 12 }}>
                {w.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={w.image} alt="" width={56} height={72} style={{ objectFit: 'cover', borderRadius: 6, flexShrink: 0 }} />
                )}
                <div style={{ flex: 1 }}>
                  <strong style={{ fontSize: 16 }}>{w.title}</strong>
                  {w.excerptSnippet && (
                    <p style={{ fontSize: 13, color: 'var(--color-muted)', marginTop: 6, whiteSpace: 'pre-wrap' }}>
                      {w.excerptSnippet}{w.hasMoreExcerpt ? '…' : ''}
                    </p>
                  )}
                  <Link href={w.href} style={{ fontSize: 13, color: 'var(--color-info)', display: 'inline-block', marginTop: 6 }}>
                    Lee un adelanto →
                  </Link>
                </div>
              </div>

              {props.open && (
                <div style={{ marginTop: 12 }}>
                  {activeWork === w.productId ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <input
                        type="email" placeholder="tu@correo.com" value={email}
                        onChange={(e) => setEmail(e.target.value)} disabled={stage === 'code_sent'}
                        style={inputStyle}
                      />
                      {stage === 'code_sent' && (
                        <input type="text" placeholder="Código de 6 caracteres" value={code} onChange={(e) => setCode(e.target.value)} style={inputStyle} />
                      )}
                      <div style={{ display: 'flex', gap: 8 }}>
                        {stage === 'idle' ? (
                          <button onClick={sendCode} disabled={busy || !email.trim()} style={primaryBtn(busy || !email.trim())}>
                            {busy ? 'Enviando…' : 'Enviar código'}
                          </button>
                        ) : (
                          <button onClick={confirmVote} disabled={busy || !code.trim()} style={primaryBtn(busy || !code.trim())}>
                            {busy ? 'Confirmando…' : 'Confirmar voto'}
                          </button>
                        )}
                        <button onClick={() => { setActiveWork(null); setStage('idle'); setError(null) }} style={ghostBtn}>Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => startVote(w.productId)} style={primaryBtn(false)}>Votar por esta obra</button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {props.terms && (
          <details style={{ marginTop: 24, fontSize: 13, color: 'var(--color-muted)' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Términos de la campaña</summary>
            <p style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>{props.terms}</p>
          </details>
        )}
        <p style={{ marginTop: 24, fontSize: 12, color: 'var(--fg-subtle)' }}>
          Un voto por correo por obra. Alcanzar la meta desbloquea un cupón de descuento sobre la impresión del libro; no es un sorteo.
        </p>
      </div>
    </main>
  )
}

function codeError(reason?: string): string {
  switch (reason) {
    case 'rate_limited': return 'Demasiados intentos. Espera un momento e inténtalo de nuevo.'
    case 'not_open': return 'Esta campaña ya no está recibiendo votos.'
    case 'invalid_email': return 'Escribe un correo válido.'
    default: return 'No se pudo enviar el código. Inténtalo de nuevo.'
  }
}

const inputStyle: React.CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid var(--border-strong)', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }
function primaryBtn(disabled: boolean): React.CSSProperties {
  return { background: disabled ? 'var(--color-muted)' : 'var(--color-accent)', color: 'var(--color-accent-foreground)', border: 'none', padding: '9px 16px', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: disabled ? 'default' : 'pointer' }
}
const ghostBtn: React.CSSProperties = { background: 'transparent', color: 'var(--color-foreground)', border: '1px solid var(--border-strong)', padding: '9px 16px', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }
