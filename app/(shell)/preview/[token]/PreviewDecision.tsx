'use client'

import { useState } from 'react'

/**
 * The merchant's explicit-consent controls on a private preview
 * (founding-merchant-consent-previews S2.1). Two deliberate actions — approve the
 * exact proposal shown, or request changes — posted to
 * `POST /api/preview/[token]/decision` with the `expectedHash` the page was
 * rendered from, so a decision never applies to a proposal the merchant didn't see
 * (versioned consent, enforced server-side). Approval publishes NOTHING here; it
 * only records consent. Activation is a separate promoter action.
 */
export default function PreviewDecision({
  token,
  expectedHash,
  approved,
  changesRequested,
  verifiedApprovalEnabled = false,
}: {
  token: string
  expectedHash: string
  approved: boolean
  changesRequested: boolean
  /** S4: when true, approving requires a one-time code sent to the merchant's own
   *  contact — a two-step "get code → enter code" flow. */
  verifiedApprovalEnabled?: boolean
}) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<null | 'approved' | 'changes_requested' | 'sending'>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<null | 'approved' | 'changes_requested'>(
    approved ? 'approved' : changesRequested ? 'changes_requested' : null,
  )
  // S4 two-step approval state: once a code is sent, the UI shows the code entry.
  const [codeSent, setCodeSent] = useState<null | 'email' | 'whatsapp'>(null)
  const [code, setCode] = useState('')

  /** S4 step 1 — request a one-time code to the merchant's contact. */
  async function sendCode() {
    setBusy('sending'); setError(null)
    try {
      const res = await fetch(`/api/preview/${encodeURIComponent(token)}/verify/start`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) {
        setError(data.error ?? 'No se pudo enviar el código. Inténtalo de nuevo.')
        return
      }
      setCodeSent(data.channel === 'whatsapp' ? 'whatsapp' : 'email')
    } catch {
      setError('Error de red. Inténtalo de nuevo.')
    } finally {
      setBusy(null)
    }
  }

  async function decide(decision: 'approved' | 'changes_requested') {
    setBusy(decision); setError(null)
    try {
      const res = await fetch(`/api/preview/${encodeURIComponent(token)}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision,
          expectedHash,
          note: note.trim() || undefined,
          ...(decision === 'approved' && codeSent ? { code: code.trim() } : {}),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 401 && data.needsCode) {
        // The code was wrong/expired/missing — stay on the code step.
        setError(data.error ?? 'El código no es correcto. Inténtalo de nuevo.')
        return
      }
      if (res.status === 409) {
        setError(data.error ?? 'La propuesta cambió. Recarga la página para ver la versión actual.')
        return
      }
      if (!res.ok || !data.ok) {
        setError(data.error ?? 'No se pudo registrar tu decisión. Inténtalo de nuevo.')
        return
      }
      setDone(decision)
    } catch {
      setError('Error de red. Inténtalo de nuevo.')
    } finally {
      setBusy(null)
    }
  }

  if (done === 'approved') {
    return (
      <div className="mt-8 rounded-lg border border-green-300 bg-green-50 px-4 py-4 text-sm text-green-900">
        <p className="font-semibold">Aprobaste esta propuesta.</p>
        <p className="mt-1 text-green-800">
          Le avisamos a quien preparó tu tienda para que la publique. Si quieres algún cambio antes,
          puedes solicitarlo abajo.
        </p>
        <button
          onClick={() => setDone(null)}
          className="mt-3 text-sm underline text-green-900"
        >
          Solicitar un cambio
        </button>
      </div>
    )
  }

  if (done === 'changes_requested') {
    return (
      <div className="mt-8 rounded-lg border border-amber-300 bg-amber-50 px-4 py-4 text-sm text-amber-900">
        <p className="font-semibold">Registramos tu solicitud de cambios.</p>
        <p className="mt-1 text-amber-800">
          La tienda sigue privada. Quien la preparó hará los ajustes y te compartirá la versión
          actualizada para tu revisión.
        </p>
        <button
          onClick={() => setDone(null)}
          className="mt-3 text-sm underline text-amber-900"
        >
          Revisar de nuevo
        </button>
      </div>
    )
  }

  // S4 step 2 — the merchant has been sent a code; show the entry + confirm.
  if (verifiedApprovalEnabled && codeSent) {
    return (
      <section className="mt-8 rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="font-semibold text-gray-900">Ingresa tu código</h2>
        <p className="mt-1 text-sm text-gray-600">
          Te enviamos un código de 6 caracteres a tu {codeSent === 'whatsapp' ? 'WhatsApp' : 'correo'}.
          Ingrésalo para confirmar que eres tú y aprobar la publicación tal como la revisaste.
        </p>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
          placeholder="Código"
          inputMode="text"
          autoCapitalize="characters"
          className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono tracking-widest"
        />
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <button
            onClick={() => decide('approved')}
            disabled={busy !== null || code.trim().length < 6}
            className="rounded-lg bg-green-600 px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            {busy === 'approved' ? 'Aprobando…' : 'Confirmar y aprobar'}
          </button>
          <button
            onClick={sendCode}
            disabled={busy !== null}
            className="rounded-lg border border-gray-300 px-4 py-2 font-medium text-gray-800 disabled:opacity-50"
          >
            {busy === 'sending' ? 'Reenviando…' : 'Reenviar código'}
          </button>
        </div>
        <button
          onClick={() => { setCodeSent(null); setCode(''); setError(null) }}
          className="mt-3 text-xs underline text-gray-500"
        >
          Cancelar
        </button>
      </section>
    )
  }

  return (
    <section className="mt-8 rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="font-semibold text-gray-900">¿Todo se ve bien?</h2>
      <p className="mt-1 text-sm text-gray-600">
        Aprueba para que se publique tal como la ves, o solicita cambios. No se publica nada hasta que
        apruebas.
      </p>
      {verifiedApprovalEnabled && (
        <p className="mt-1 text-xs text-gray-500">
          Para aprobar te enviaremos un código a tu contacto — así confirmamos que la aprobación es
          tuya. (Esto confirma tu contacto, no es una firma legal.)
        </p>
      )}
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="¿Algún comentario o cambio? (opcional)"
        rows={2}
        className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
      />
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <button
          onClick={() => (verifiedApprovalEnabled ? sendCode() : decide('approved'))}
          disabled={busy !== null}
          className="rounded-lg bg-green-600 px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          {verifiedApprovalEnabled
            ? (busy === 'sending' ? 'Enviando código…' : 'Aprobar y publicar')
            : (busy === 'approved' ? 'Aprobando…' : 'Aprobar y publicar')}
        </button>
        <button
          onClick={() => decide('changes_requested')}
          disabled={busy !== null}
          className="rounded-lg border border-gray-300 px-4 py-2 font-medium text-gray-800 disabled:opacity-50"
        >
          {busy === 'changes_requested' ? 'Enviando…' : 'Solicitar cambios'}
        </button>
      </div>
    </section>
  )
}
