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
      cond_new: 'Nuevo', cond_like_new: 'Como nuevo', cond_used: 'Usado',
    },
    en: {
      buy: 'Buy now', view: 'View listing', sold: 'Sold out',
      unavailable: 'Unavailable', loading: 'Loading…', error: 'Could not load',
      by: 'by', secure: 'Secure checkout on miyagisanchez.com',
      cond_new: 'New', cond_like_new: 'Like new', cond_used: 'Used',
    },
  }
  function conditionLabel(locale, condition) {
    if (!condition) return ''
    var k = condition === 'new' ? 'cond_new'
      : condition === 'like_new' ? 'cond_like_new'
      : 'cond_used'
    return t(locale, k)
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

  // ── <miyagi-product> ───────────────────────────────────────────────────────
  // A richer, read-only product card (image, title, price, condition + CTA). It
  // reuses the exact same hosted-checkout hand-off as the buy-button — no new
  // checkout logic.
  function cardStyle(accent) {
    return baseStyle(accent) +
      ':host{display:block;max-width:280px}' +
      '.mi-card{border:1px solid #e6e8eb;border-radius:14px;overflow:hidden;' +
      'background:#fff;display:flex;flex-direction:column;width:100%}' +
      '.mi-img{width:100%;aspect-ratio:1/1;object-fit:cover;background:#f3f4f6;display:block}' +
      '.mi-img-ph{width:100%;aspect-ratio:1/1;background:#f3f4f6;display:flex;' +
      'align-items:center;justify-content:center;color:#c0c4c8;font-size:28px}' +
      '.mi-body{padding:12px 13px;display:flex;flex-direction:column;gap:7px}' +
      '.mi-title{font-size:14px;font-weight:700;color:#111;margin:0;' +
      'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}' +
      '.mi-row{display:flex;align-items:center;justify-content:space-between;gap:8px}' +
      '.mi-price{font-size:17px}' +
      '.mi-cond{font-size:11px;color:#5f6368;border:1px solid #e6e8eb;' +
      'border-radius:999px;padding:2px 8px;white-space:nowrap}' +
      '.mi-cta{margin-top:2px;width:100%;justify-content:center}' +
      '.mi-foot{font-size:10px;color:#9aa0a6;text-align:center;padding:0 0 9px}'
  }

  function defineProductCard() {
    if (customElements.get('miyagi-product')) return
    customElements.define('miyagi-product', class extends HTMLElement {
      connectedCallback() {
        if (this._mounted) return
        this._mounted = true
        var root = this.attachShadow({ mode: 'open' })
        var locale = this.getAttribute('data-locale')
        var listingId = this.getAttribute('data-listing')
        var key = this.getAttribute('data-key')

        root.innerHTML = '<style>' + cardStyle('#111') + '</style>' +
          '<div class="mi-card"><div class="mi-img-ph">' + esc(t(locale, 'loading')) + '</div></div>'

        if (!listingId) {
          root.innerHTML = '<style>' + cardStyle('#111') + '</style>' +
            '<span class="mi-err">miyagi-product: data-listing required</span>'
          return
        }

        fetchListing(listingId, key).then(function (listing) {
          var buyable = !!(listing.actions && listing.actions.buy_now)
          var inStock = listing.in_stock !== false
          var price = listing.price && listing.price.formatted ? listing.price.formatted : ''
          var img = listing.images && listing.images[0] ? listing.images[0].url : ''
          var cond = conditionLabel(locale, listing.condition)
          var accent = '#111'
          var label = !inStock ? t(locale, 'sold')
            : buyable ? t(locale, 'buy')
            : t(locale, 'view')

          root.innerHTML = '<style>' + cardStyle(accent) + '</style>' +
            '<div class="mi-card">' +
            (img
              ? '<img class="mi-img" src="' + esc(img) + '" alt="' + esc(listing.title) + '">'
              : '<div class="mi-img-ph">🏪</div>') +
            '<div class="mi-body">' +
            '<p class="mi-title">' + esc(listing.title) + '</p>' +
            '<div class="mi-row">' +
            (price ? '<span class="mi-price" style="font-weight:800;color:#111">' + esc(price) + '</span>' : '<span></span>') +
            (cond ? '<span class="mi-cond">' + esc(cond) + '</span>' : '') +
            '</div>' +
            '<button class="mi-btn mi-cta" type="button"' + (!inStock ? ' disabled' : '') + '>' +
            '<span>' + esc(label) + '</span></button>' +
            '</div>' +
            '<div class="mi-foot">' + esc(t(locale, 'secure')) + '</div>' +
            '</div>'

          var btn = root.querySelector('button')
          if (btn && inStock) {
            btn.addEventListener('click', function () { openCheckout(listingId, buyable) })
          }
        }).catch(function () {
          root.innerHTML = '<style>' + cardStyle('#111') + '</style>' +
            '<span class="mi-err">' + esc(t(locale, 'error')) + '</span>'
        })
      }
    })
  }

  defineBuyButton()
  defineProductCard()
})()
