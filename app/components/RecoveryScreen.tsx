'use client'

import { useSyncExternalStore } from 'react'
import Link from 'next/link'
import { CONTACT_EMAIL, contactMailto } from '@/lib/contact'
import { PLATFORM_ORIGIN } from '@/lib/shortlink'
import '@/app/recovery.css'

function subscribeToLocation(onChange: () => void) {
  window.addEventListener('popstate', onChange)
  return () => window.removeEventListener('popstate', onChange)
}

function requestedMarketFromAddressBar(): 'mx' | 'us' {
  const path = window.location.pathname
  return path === '/us' || path.startsWith('/us/') ? 'us' : 'mx'
}

export default function RecoveryScreen({
  code,
  title,
  message,
  onRetry,
  market,
}: {
  code: '404' | '500'
  title: string
  message: string
  onRetry?: () => void
  market?: 'mx' | 'us'
}) {
  // Rewritten ISR pages can expose the internal route to usePathname(). The
  // address bar still has the original public URL and needs no server request
  // read. Until hydration, the market selector is a safe destination.
  const requestedMarket = useSyncExternalStore(
    subscribeToLocation,
    requestedMarketFromAddressBar,
    () => null,
  )
  const browseMarket = market ?? requestedMarket
  const browseUrl = browseMarket ? `${PLATFORM_ORIGIN}/${browseMarket}/l` : PLATFORM_ORIGIN
  return (
    <main className="recovery-page">
      <section className="recovery-card" aria-labelledby="recovery-title">
        <div className="recovery-rule" aria-hidden="true" />
        <p className="recovery-kicker">Algo se salió del camino</p>
        <p className="recovery-code" aria-hidden="true">{code}</p>
        <h1 id="recovery-title">{title}</h1>
        <p className="recovery-message">{message}</p>
        <div className="recovery-actions">
          {onRetry && <button type="button" className="recovery-primary" onClick={onRetry}>Intentar de nuevo</button>}
          {/* An absolute platform URL also works on merchant custom domains. */}
          <a className={onRetry ? 'recovery-secondary' : 'recovery-primary'} href={browseUrl}>Explorar anuncios</a>
          <Link className="recovery-secondary" href="/">Ir al inicio</Link>
        </div>
        <p className="recovery-help">
          ¿Necesitas ayuda? <a href={contactMailto(`Error ${code}`)}>Escríbenos a {CONTACT_EMAIL}</a>
        </p>
      </section>
    </main>
  )
}
