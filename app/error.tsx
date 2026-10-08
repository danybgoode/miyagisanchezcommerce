'use client'

import { CONTACT_EMAIL, contactMailto } from '@/lib/contact'
import '@/app/recovery.css'

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="recovery-page">
      <section className="recovery-card" aria-labelledby="recovery-title">
        <div className="recovery-rule" aria-hidden="true" />
        <p className="recovery-kicker">Algo se salió del camino</p>
        <p className="recovery-code" aria-hidden="true">500</p>
        <h1 id="recovery-title">No pudimos mostrar esta página</h1>
        <p className="recovery-message">Hubo un problema al cargarla. Intenta de nuevo o vuelve a explorar.</p>
        <div className="recovery-actions">
          <button type="button" className="recovery-primary" onClick={reset}>Intentar de nuevo</button>
          {/* A native link still works when the root layout and client router fail. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a className="recovery-secondary" href="/">Ir al inicio</a>
        </div>
        <p className="recovery-help">¿Necesitas ayuda? <a href={contactMailto('Error 500')}>Escríbenos a {CONTACT_EMAIL}</a></p>
      </section>
    </main>
  )
}
