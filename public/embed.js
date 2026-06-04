/*!
 * Miyagi Sánchez — Embeddable Widget loader (07 · Embeddable Widget, Sprint 2).
 *
 * Drop this one <script> onto any website to render a seller's products and
 * sell from it. It registers two style-isolated (Shadow DOM) custom elements:
 *
 *   <miyagi-buy-button data-listing="prod_…" data-key="emb_pk_…"></miyagi-buy-button>
 *   <miyagi-product    data-listing="prod_…" data-key="emb_pk_…"></miyagi-product>
 *
 * It reads PUBLIC data from our CORS-open UCP catalog API and, on buy, hands off
 * to our HOSTED checkout on miyagisanchez.com (a popup tagged channel=embed).
 * It NEVER renders a payment surface on the host page — live payments stay 100%
 * on our domain. The embed key is publishable: it attributes + themes the widget.
 *
 * No build step, no dependencies — a plain IIFE that works as a classic script.
 */
(function () {
  'use strict'

  // Guard against double-inclusion (a page may paste the snippet more than once).
  if (window.__miyagiEmbedLoaded) return
  window.__miyagiEmbedLoaded = true

  // The API origin = wherever THIS script was served from, so the widget always
  // calls back to the right Miyagi deployment (prod, or a preview during QA).
  var API = (function () {
    try {
      var s = document.currentScript || (function () {
        var all = document.getElementsByTagName('script')
        for (var i = all.length - 1; i >= 0; i--) {
          if (/\/embed\.js(\?|$)/.test(all[i].src)) return all[i]
        }
        return null
      })()
      if (s && s.src) return new URL(s.src).origin
    } catch (e) { /* fall through */ }
    return 'https://miyagisanchez.com'
  })()

  // ── i18n (self-contained — the loader is standalone, not in the app i18n) ──
  var STRINGS = {
    es: {
      buy: 'Comprar', view: 'Ver anuncio', sold: 'Agotado',
      unavailable: 'No disponible', loading: 'Cargando…', error: 'No se pudo cargar',
      by: 'por', secure: 'Pago seguro en miyagisanchez.com',
    },
    en: {
      buy: 'Buy now', view: 'View listing', sold: 'Sold out',
      unavailable: 'Unavailable', loading: 'Loading…', error: 'Could not load',
      by: 'by', secure: 'Secure checkout on miyagisanchez.com',
    },
  }
  function t(locale, key) {
    var dict = STRINGS[locale === 'en' ? 'en' : 'es']
    return dict[key] || STRINGS.es[key] || key
  }

  // ── Shared helpers ─────────────────────────────────────────────────────────

  function fetchListing(listingId, key) {
    var url = API + '/api/ucp/catalog/' + encodeURIComponent(listingId) + '?channel=embed'
    if (key) url += '&key=' + encodeURIComponent(key)
    return fetch(url, { headers: key ? { 'x-miyagi-embed-key': key } : {} })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json() })
  }

  // Hand off to the HOSTED checkout in a popup, tagged channel=embed so the sale
  // is attributed to the embed channel. Falls back to a same-tab nav if the popup
  // is blocked. Never renders payment on the host origin.
  function openCheckout(listingId, buyable) {
    // If the item isn't directly buyable, send the visitor to the full listing.
    var path = buyable
      ? '/checkout?listingId=' + encodeURIComponent(listingId) + '&channel=embed'
      : '/l/' + encodeURIComponent(listingId) + '?channel=embed'
    var url = API + path
    var win = window.open(url, 'miyagi_checkout',
      'popup,noopener,noreferrer,width=480,height=820')
    if (!win) window.open(url, '_blank', 'noopener,noreferrer')
  }

  // Minimal HTML escape for any seller-controlled text we inject into the shadow.
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  // Shared base styles for the shadow root — fully self-contained, no host bleed.
  function baseStyle(accent) {
    return (
      ':host{all:initial;display:inline-block;font-family:system-ui,-apple-system,' +
      'Segoe UI,Roboto,sans-serif;line-height:1.4;--mi-accent:' + (accent || '#111') + '}' +
      '*{box-sizing:border-box}' +
      '.mi-btn{appearance:none;border:0;border-radius:10px;cursor:pointer;' +
      'background:var(--mi-accent);color:#fff;font-weight:700;font-size:15px;' +
      'padding:11px 18px;display:inline-flex;align-items:center;gap:8px;' +
      'transition:opacity .15s ease;white-space:nowrap;max-width:100%}' +
      '.mi-btn:hover{opacity:.88}' +
      '.mi-btn:disabled{opacity:.5;cursor:not-allowed}' +
      '.mi-price{font-weight:800}' +
      '.mi-skel{color:#9aa0a6;font-size:14px;padding:10px 16px;' +
      'border:1px dashed #d6d9dc;border-radius:10px;display:inline-block}' +
      '.mi-err{color:#b00020;font-size:13px}'
    )
  }

  // ── <miyagi-buy-button> ────────────────────────────────────────────────────
  function defineBuyButton() {
    if (customElements.get('miyagi-buy-button')) return
    customElements.define('miyagi-buy-button', class extends HTMLElement {
      connectedCallback() {
        if (this._mounted) return
        this._mounted = true
        var root = this.attachShadow({ mode: 'open' })
        var locale = this.getAttribute('data-locale')
        var listingId = this.getAttribute('data-listing')
        var key = this.getAttribute('data-key')
        var labelOverride = this.getAttribute('data-label')

        root.innerHTML = '<style>' + baseStyle('#111') + '</style>' +
          '<span class="mi-skel">' + esc(t(locale, 'loading')) + '</span>'

        if (!listingId) {
          root.innerHTML = '<style>' + baseStyle('#111') + '</style>' +
            '<span class="mi-err">miyagi-buy-button: data-listing required</span>'
          return
        }

        fetchListing(listingId, key).then(function (listing) {
          var buyable = !!(listing.actions && listing.actions.buy_now)
          var inStock = listing.in_stock !== false
          var price = listing.price && listing.price.formatted ? listing.price.formatted : ''
          var accent = '#111'
          var label = labelOverride
            || (!inStock ? t(locale, 'sold')
              : buyable ? (t(locale, 'buy') + (price ? ' · ' + price : ''))
              : t(locale, 'view'))

          root.innerHTML = '<style>' + baseStyle(accent) + '</style>' +
            '<button class="mi-btn" type="button"' + (!inStock ? ' disabled' : '') + '>' +
            '<span>' + esc(label) + '</span></button>'

          var btn = root.querySelector('button')
          if (btn && inStock) {
            btn.addEventListener('click', function () { openCheckout(listingId, buyable) })
          }
        }).catch(function () {
          root.innerHTML = '<style>' + baseStyle('#111') + '</style>' +
            '<span class="mi-err">' + esc(t(locale, 'error')) + '</span>'
        })
      }
    })
  }

  defineBuyButton()
  // <miyagi-product> card is registered by the same loader in US-4.
})()
