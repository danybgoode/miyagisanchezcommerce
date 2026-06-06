/*!
 * Miyagi Sánchez — Embeddable Widget loader (07 · Embeddable Widget, Sprint 2).
 *
 * Drop this one <script> onto any website to render a seller's products and
 * sell from it. It registers two style-isolated (Shadow DOM) custom elements:
 *
 *   <miyagi-buy-button data-listing="prod_…" data-key="emb_pk_…"></miyagi-buy-button>
 *   <miyagi-product    data-listing="prod_…" data-key="emb_pk_…"></miyagi-product>
 *   <miyagi-support-widget data-key="emb_pk_…"></miyagi-support-widget>
 *
 * Optional theming/locale attributes (US-7): data-accent="#1d6f42" tints the CTA,
 * data-locale="en" switches copy to English (default es-MX). The seller's snippet
 * generator prefills these from their shop's brand color.
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
      support: 'Apoyar', support_for: 'Apoyar a', choose_amount: 'Elige un monto',
      custom_amount: 'Otro monto', name_optional: 'Nombre (opcional)',
      email: 'Correo para recibo', message_optional: 'Mensaje (opcional)',
      public: 'Público', private: 'Privado', pay_with_stripe: 'Pagar con Stripe',
      pay_with_mp: 'Pagar con Mercado Pago', support_secure: 'Pago seguro en Miyagi',
      close: 'Cerrar', continue: 'Continuar', processing: 'Abriendo pago…',
      amount_error: 'El monto está fuera del rango permitido.',
      email_error: 'Ingresa un correo válido para recibir tu recibo.',
      message_error: 'El mensaje no puede superar 250 caracteres.',
      provider_unavailable: 'Este vendedor aún no tiene pagos activos.',
      support_unavailable: 'Apoyos no disponibles', support_success: '¡Gracias por apoyar!',
      support_success_body: 'Tu contribución quedó registrada.',
    },
    en: {
      buy: 'Buy now', view: 'View listing', sold: 'Sold out',
      unavailable: 'Unavailable', loading: 'Loading…', error: 'Could not load',
      by: 'by', secure: 'Secure checkout on miyagisanchez.com',
      cond_new: 'New', cond_like_new: 'Like new', cond_used: 'Used',
      support: 'Support', support_for: 'Support', choose_amount: 'Choose an amount',
      custom_amount: 'Custom amount', name_optional: 'Name (optional)',
      email: 'Email for receipt', message_optional: 'Message (optional)',
      public: 'Public', private: 'Private', pay_with_stripe: 'Pay with Stripe',
      pay_with_mp: 'Pay with Mercado Pago', support_secure: 'Secure payment on Miyagi',
      close: 'Close', continue: 'Continue', processing: 'Opening payment…',
      amount_error: 'The amount is outside the allowed range.',
      email_error: 'Enter a valid email for your receipt.',
      message_error: 'Message cannot exceed 250 characters.',
      provider_unavailable: 'This seller has not enabled payments yet.',
      support_unavailable: 'Support unavailable', support_success: 'Thank you for the support!',
      support_success_body: 'Your contribution was recorded.',
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

  function fetchSupportConfig(key) {
    var url = API + '/api/embed/support'
    if (key) url += '?key=' + encodeURIComponent(key)
    return fetch(url, { headers: key ? { 'x-miyagi-embed-key': key } : {} })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json() })
  }

  function formatMoney(cents, currency, locale) {
    try {
      return new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-MX', {
        style: 'currency',
        currency: currency || 'MXN',
        maximumFractionDigits: 0,
      }).format((Number(cents) || 0) / 100)
    } catch (e) {
      return '$' + Math.round((Number(cents) || 0) / 100)
    }
  }

  function validEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim())
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
    // NB: do NOT pass `noopener` in the feature string — it makes window.open()
    // return null even on success, which would defeat the popup-blocked check
    // below and double-open. Instead sever the opener on the returned handle.
    var win = window.open(url, 'miyagi_checkout', 'popup,width=480,height=820')
    if (win) { try { win.opener = null } catch (e) { /* cross-origin: ignore */ } }
    else { window.open(url, '_blank', 'noopener') }   // popup blocked → new tab
  }

  function openSupportCheckout(url) {
    var win = window.open(url, 'miyagi_support_checkout', 'popup,width=480,height=820')
    if (!win) window.open(url, '_blank', 'noopener')
    return win
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

  function supportLayout(value) {
    return value === 'inline' || value === 'preview' ? value : 'floating'
  }

  function supportPosition(value) {
    return value === 'bottom-left' ? 'bottom-left' : 'bottom-right'
  }

  function previewSupportConfig(el) {
    var enabled = el.getAttribute('data-preview-enabled') !== 'false'
    var presets = String(el.getAttribute('data-preview-presets') || '')
      .split(',')
      .map(function (v) { return Math.round(Number(v)) })
      .filter(function (v) { return Number.isFinite(v) && v > 0 })
    if (presets.length !== 3) presets = [5000, 10000, 20000]
    return {
      valid: true,
      shop: {
        name: el.getAttribute('data-preview-shop') || '',
        accent_color: el.getAttribute('data-accent') || '#111',
      },
      support: {
        enabled: enabled,
        preset_amount_cents: presets,
        custom_min_cents: Math.round(Number(el.getAttribute('data-preview-min') || 2000)),
        custom_max_cents: Math.round(Number(el.getAttribute('data-preview-max') || 500000)),
        currency: el.getAttribute('data-preview-currency') || 'MXN',
        default_visibility: el.getAttribute('data-preview-visibility') === 'private' ? 'private' : 'public',
      },
      payment_providers: { stripe: enabled, mercadopago: enabled },
    }
  }

  function supportStyle(accent, layout, position) {
    var left = position === 'bottom-left'
    var side = left ? 'left' : 'right'
    var sideInset = left ? 'safe-area-inset-left' : 'safe-area-inset-right'
    var hostStyle = layout === 'inline'
      ? ':host{display:inline-block}'
      : layout === 'preview'
        ? ':host{position:absolute;inset:0;display:block;z-index:1;pointer-events:none}'
        : ':host{position:fixed;bottom:calc(24px + env(safe-area-inset-bottom));' +
          side + ':calc(24px + env(' + sideInset + '));display:block;z-index:2147483646}'
    var launcherStyle = layout === 'preview'
      ? '.mi-support-btn{position:absolute;bottom:16px;' + side + ':16px;pointer-events:auto}'
      : '.mi-support-btn{}'
    var backdropPosition = layout === 'preview' ? 'absolute' : 'fixed'
    var mobileHostStyle = layout === 'floating'
      ? ':host{bottom:calc(16px + env(safe-area-inset-bottom));' + side + ':calc(16px + env(' + sideInset + '))}'
      : ''
    return baseStyle(accent) +
      hostStyle +
      launcherStyle +
      '.mi-support-btn{box-shadow:0 8px 20px rgba(0,0,0,.12)}' +
      '.mi-backdrop{position:' + backdropPosition + ';inset:0;z-index:2147483647;background:rgba(15,23,42,.46);' +
      'display:flex;align-items:center;justify-content:center;padding:18px;pointer-events:auto}' +
      '.mi-modal{width:min(420px,100%);max-height:min(720px,calc(100vh - 24px));overflow:auto;' +
      'background:#fff;border-radius:18px;box-shadow:0 24px 70px rgba(15,23,42,.28);color:#111}' +
      '.mi-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:18px 18px 10px}' +
      '.mi-title{font-size:18px;font-weight:800;margin:0;color:#111}.mi-sub{font-size:13px;color:#667085;margin:4px 0 0}' +
      '.mi-x{appearance:none;border:0;background:#f3f4f6;color:#111;border-radius:999px;width:32px;height:32px;' +
      'font-size:20px;line-height:1;cursor:pointer}.mi-body{padding:0 18px 18px;display:flex;flex-direction:column;gap:13px}' +
      '.mi-label{display:block;font-size:12px;font-weight:700;color:#344054;margin:0 0 6px}' +
      '.mi-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.mi-choice{appearance:none;border:1px solid #d0d5dd;' +
      'background:#fff;border-radius:10px;padding:10px 8px;font-weight:800;color:#111;cursor:pointer;text-align:center}' +
      '.mi-choice[data-active="1"]{border-color:var(--mi-accent);background:color-mix(in srgb,var(--mi-accent) 10%,white);color:var(--mi-accent)}' +
      '.mi-field{width:100%;border:1px solid #d0d5dd;border-radius:10px;padding:10px 11px;font:inherit;font-size:14px;color:#111;background:#fff}' +
      '.mi-field:focus{outline:2px solid color-mix(in srgb,var(--mi-accent) 25%,transparent);border-color:var(--mi-accent)}' +
      '.mi-row2{display:grid;grid-template-columns:1fr 1fr;gap:9px}.mi-vis{display:grid;grid-template-columns:1fr 1fr;border:1px solid #d0d5dd;' +
      'border-radius:10px;overflow:hidden}.mi-vis button{appearance:none;border:0;background:#fff;padding:10px;font-weight:700;color:#475467;cursor:pointer}' +
      '.mi-vis button[data-active="1"]{background:var(--mi-accent);color:#fff}.mi-actions{display:flex;flex-direction:column;gap:8px}' +
      '.mi-pay{appearance:none;border:0;border-radius:11px;padding:12px 14px;font-size:14px;font-weight:800;color:#fff;cursor:pointer;background:#111}' +
      '.mi-pay[data-provider="mercadopago"]{background:#009ee3}.mi-pay:disabled{opacity:.45;cursor:not-allowed}' +
      '.mi-note{font-size:11px;color:#667085;text-align:center}.mi-error{border:1px solid #fecaca;background:#fef2f2;color:#991b1b;' +
      'border-radius:10px;padding:9px 10px;font-size:13px}.mi-success{padding:24px 18px 26px;text-align:center}.mi-success h3{margin:0 0 8px;' +
      'font-size:20px;color:#111}.mi-success p{margin:0;color:#667085;font-size:14px}.mi-pop{font-size:34px;margin-bottom:10px}' +
      '@media(max-width:480px){' + mobileHostStyle +
      '.mi-backdrop{align-items:flex-end;padding:0}.mi-modal{border-radius:18px 18px 0 0;max-height:calc(100vh - 16px)}}'
  }

  // ── <miyagi-support-widget> ────────────────────────────────────────────────
  function defineSupportWidget() {
    if (customElements.get('miyagi-support-widget')) return
    customElements.define('miyagi-support-widget', class extends HTMLElement {
      connectedCallback() {
        if (this._mounted) return
        this._mounted = true
        this._root = this.attachShadow({ mode: 'open' })
        this._locale = this.getAttribute('data-locale')
        this._key = this.getAttribute('data-key')
        this._accent = this.getAttribute('data-accent') || '#111'
        this._label = this.getAttribute('data-label')
        this._layout = supportLayout(this.getAttribute('data-layout') || (this.getAttribute('data-preview') === 'true' ? 'preview' : 'floating'))
        this._position = supportPosition(this.getAttribute('data-position'))
        this._open = false
        this._success = false
        this._pendingCartId = null
        this._state = null
        var self = this

        this._onMessage = function (event) {
          if (event.origin !== API) return
          var data = event.data || {}
          if (data.type !== 'miyagi:support:success') return
          if (self._pendingCartId && data.cart_id && data.cart_id !== self._pendingCartId) return
          self.showSuccess()
        }
        window.addEventListener('message', this._onMessage)

        this.renderLoading()
        if (this.getAttribute('data-preview') === 'true') {
          this._config = previewSupportConfig(this)
          this.render()
          return
        }
        if (!this._key) {
          this.renderUnavailable('miyagi-support-widget: data-key required')
          return
        }
        fetchSupportConfig(this._key).then(function (config) {
          self._config = config
          var shopAccent = config.shop && config.shop.accent_color
          if (!self.getAttribute('data-accent') && shopAccent) self._accent = shopAccent
          self.render()
        }).catch(function () {
          self.renderUnavailable(t(self._locale, 'support_unavailable'))
        })
      }

      disconnectedCallback() {
        if (this._onMessage) window.removeEventListener('message', this._onMessage)
        if (this._closeTimer) clearTimeout(this._closeTimer)
      }

      renderLoading() {
        this._root.innerHTML = '<style>' + supportStyle(this._accent, this._layout, this._position) + '</style>' +
          '<span class="mi-skel">' + esc(t(this._locale, 'loading')) + '</span>'
      }

      renderUnavailable(message) {
        this._root.innerHTML = '<style>' + supportStyle(this._accent, this._layout, this._position) + '</style>' +
          '<span class="mi-err">' + esc(message || t(this._locale, 'support_unavailable')) + '</span>'
      }

      openModal() {
        var config = this._config || {}
        var support = config.support || {}
        var presets = support.preset_amount_cents || [5000, 10000, 20000]
        this._open = true
        this._success = false
        this._state = {
          amount_cents: presets[0] || 5000,
          custom_pesos: '',
          name: '',
          email: '',
          message: '',
          visibility: support.default_visibility || 'public',
          error: '',
          busy: false,
        }
        this.render()
      }

      closeModal() {
        this._open = false
        this._success = false
        this.render()
      }

      showSuccess() {
        if (this._closeTimer) clearTimeout(this._closeTimer)
        this._open = true
        this._success = true
        this.render()
        var self = this
        this._closeTimer = setTimeout(function () { self.closeModal() }, 3000)
      }

      setVisibility(value) {
        if (!this._state) return
        this._state.visibility = value
        this.render()
      }

      setPreset(cents) {
        if (!this._state) return
        this._state.amount_cents = cents
        this._state.custom_pesos = ''
        this._state.error = ''
        this.render()
      }

      syncFields() {
        if (!this._state) return
        var root = this._root
        var custom = root.querySelector('[data-custom]')
        var name = root.querySelector('[data-name]')
        var email = root.querySelector('[data-email]')
        var message = root.querySelector('[data-message]')
        this._state.custom_pesos = custom ? custom.value : this._state.custom_pesos
        this._state.name = name ? name.value : this._state.name
        this._state.email = email ? email.value : this._state.email
        this._state.message = message ? message.value : this._state.message
      }

      submit(provider) {
        var self = this
        var config = this._config || {}
        var support = config.support || {}
        this.syncFields()
        var state = this._state || {}
        var amount = state.custom_pesos && String(state.custom_pesos).trim()
          ? Math.round(Number(state.custom_pesos) * 100)
          : state.amount_cents
        var min = Number(support.custom_min_cents || 100)
        var max = Number(support.custom_max_cents || 500000)
        if (!amount || amount < min || amount > max) {
          state.error = t(this._locale, 'amount_error')
          this.render()
          return
        }
        if (!validEmail(state.email)) {
          state.error = t(this._locale, 'email_error')
          this.render()
          return
        }
        if (String(state.message || '').length > 250) {
          state.error = t(this._locale, 'message_error')
          this.render()
          return
        }
        state.busy = true
        state.error = ''
        this.render()

        fetch(API + '/api/embed/support/checkout', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-miyagi-embed-key': this._key,
          },
          body: JSON.stringify({
            embed_key: this._key,
            provider: provider,
            amount_cents: amount,
            supporter_name: state.name,
            supporter_email: state.email,
            message: state.message,
            visibility: state.visibility,
          }),
        }).then(function (r) {
          return r.json().then(function (data) {
            if (!r.ok) throw new Error(data.error || data.message || 'checkout failed')
            return data
          })
        }).then(function (data) {
          self._pendingCartId = data.cart_id || null
          state.busy = false
          self.render()
          if (data.checkout_url || data.redirect_url) openSupportCheckout(data.checkout_url || data.redirect_url)
        }).catch(function (err) {
          state.busy = false
          state.error = err && err.message ? err.message : t(self._locale, 'error')
          self.render()
        })
      }

      render() {
        var config = this._config || {}
        var support = config.support || {}
        var providers = config.payment_providers || {}
        var hasProvider = !!(providers.stripe || providers.mercadopago)
        var shopName = config.shop && config.shop.name ? config.shop.name : ''
        var buttonLabel = this._label || t(this._locale, 'support')
        var html = '<style>' + supportStyle(this._accent, this._layout, this._position) + '</style>' +
          '<button class="mi-btn mi-support-btn" type="button"' + (!hasProvider ? ' disabled' : '') + ' data-open>' +
          '<span>' + esc(buttonLabel) + '</span></button>'

        if (!hasProvider) {
          html += '<span class="mi-err" style="display:block;margin-top:7px">' + esc(t(this._locale, 'provider_unavailable')) + '</span>'
        }

        if (this._open) {
          html += this._success ? this.successHtml() : this.modalHtml(shopName, support, providers)
        }

        this._root.innerHTML = html
        this.bind()
      }

      successHtml() {
        return '<div class="mi-backdrop" data-close><div class="mi-modal" role="dialog" aria-modal="true" data-stop>' +
          '<div class="mi-success"><div class="mi-pop">✓</div>' +
          '<h3>' + esc(t(this._locale, 'support_success')) + '</h3>' +
          '<p>' + esc(t(this._locale, 'support_success_body')) + '</p></div></div></div>'
      }

      modalHtml(shopName, support, providers) {
        var state = this._state || {}
        var presets = support.preset_amount_cents || [5000, 10000, 20000]
        var currency = support.currency || 'MXN'
        var min = formatMoney(support.custom_min_cents || 100, currency, this._locale)
        var max = formatMoney(support.custom_max_cents || 500000, currency, this._locale)
        var presetHtml = presets.map(function (amount) {
          return '<button type="button" class="mi-choice" data-amount="' + amount + '" data-active="' +
            (state.amount_cents === amount && !state.custom_pesos ? '1' : '0') + '">' +
            esc(formatMoney(amount, currency, this._locale)) + '</button>'
        }, this).join('')

        return '<div class="mi-backdrop" data-close><div class="mi-modal" role="dialog" aria-modal="true" data-stop>' +
          '<div class="mi-head"><div><p class="mi-title">' + esc(t(this._locale, 'support_for')) +
          (shopName ? ' ' + esc(shopName) : '') + '</p><p class="mi-sub">' + esc(t(this._locale, 'support_secure')) +
          '</p></div><button class="mi-x" type="button" data-close-btn aria-label="' + esc(t(this._locale, 'close')) + '">×</button></div>' +
          '<div class="mi-body">' +
          (state.error ? '<div class="mi-error">' + esc(state.error) + '</div>' : '') +
          '<div><label class="mi-label">' + esc(t(this._locale, 'choose_amount')) + '</label><div class="mi-grid">' + presetHtml + '</div></div>' +
          '<div><label class="mi-label">' + esc(t(this._locale, 'custom_amount')) + ' <span style="font-weight:500;color:#667085">(' + esc(min) + ' - ' + esc(max) + ')</span></label>' +
          '<input class="mi-field" data-custom type="number" min="1" step="10" value="' + esc(state.custom_pesos || '') + '" placeholder="100"></div>' +
          '<div class="mi-row2"><div><label class="mi-label">' + esc(t(this._locale, 'name_optional')) + '</label>' +
          '<input class="mi-field" data-name maxlength="80" value="' + esc(state.name || '') + '"></div>' +
          '<div><label class="mi-label">' + esc(t(this._locale, 'email')) + '</label>' +
          '<input class="mi-field" data-email type="email" value="' + esc(state.email || '') + '"></div></div>' +
          '<div><label class="mi-label">' + esc(t(this._locale, 'message_optional')) + '</label>' +
          '<textarea class="mi-field" data-message maxlength="250" rows="3">' + esc(state.message || '') + '</textarea></div>' +
          '<div class="mi-vis"><button type="button" data-vis="public" data-active="' + (state.visibility !== 'private' ? '1' : '0') + '">' +
          esc(t(this._locale, 'public')) + '</button><button type="button" data-vis="private" data-active="' + (state.visibility === 'private' ? '1' : '0') + '">' +
          esc(t(this._locale, 'private')) + '</button></div>' +
          '<div class="mi-actions">' +
          '<button class="mi-pay" type="button" data-provider="stripe"' + (!providers.stripe || state.busy ? ' disabled' : '') + '>' +
          esc(state.busy ? t(this._locale, 'processing') : t(this._locale, 'pay_with_stripe')) + '</button>' +
          '<button class="mi-pay" type="button" data-provider="mercadopago"' + (!providers.mercadopago || state.busy ? ' disabled' : '') + '>' +
          esc(state.busy ? t(this._locale, 'processing') : t(this._locale, 'pay_with_mp')) + '</button>' +
          '</div><div class="mi-note">' + esc(t(this._locale, 'secure')) + '</div>' +
          '</div></div></div>'
      }

      bind() {
        var self = this
        var root = this._root
        var open = root.querySelector('[data-open]')
        if (open) open.addEventListener('click', function () { self.openModal() })
        root.querySelectorAll('[data-close], [data-close-btn]').forEach(function (el) {
          el.addEventListener('click', function () { self.closeModal() })
        })
        root.querySelectorAll('[data-stop]').forEach(function (el) {
          el.addEventListener('click', function (event) { event.stopPropagation() })
        })
        root.querySelectorAll('[data-amount]').forEach(function (el) {
          el.addEventListener('click', function () { self.setPreset(Number(el.getAttribute('data-amount'))) })
        })
        root.querySelectorAll('[data-vis]').forEach(function (el) {
          el.addEventListener('click', function () { self.setVisibility(el.getAttribute('data-vis') === 'private' ? 'private' : 'public') })
        })
        root.querySelectorAll('[data-provider]').forEach(function (el) {
          el.addEventListener('click', function () { self.submit(el.getAttribute('data-provider')) })
        })
      }
    })
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
        var accent = this.getAttribute('data-accent') || '#111'

        root.innerHTML = '<style>' + baseStyle(accent) + '</style>' +
          '<span class="mi-skel">' + esc(t(locale, 'loading')) + '</span>'

        if (!listingId) {
          root.innerHTML = '<style>' + baseStyle(accent) + '</style>' +
            '<span class="mi-err">miyagi-buy-button: data-listing required</span>'
          return
        }

        fetchListing(listingId, key).then(function (listing) {
          var buyable = !!(listing.actions && listing.actions.buy_now)
          var inStock = listing.in_stock !== false
          var price = listing.price && listing.price.formatted ? listing.price.formatted : ''
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
          root.innerHTML = '<style>' + baseStyle(accent) + '</style>' +
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
        var accent = this.getAttribute('data-accent') || '#111'

        root.innerHTML = '<style>' + cardStyle(accent) + '</style>' +
          '<div class="mi-card"><div class="mi-img-ph">' + esc(t(locale, 'loading')) + '</div></div>'

        if (!listingId) {
          root.innerHTML = '<style>' + cardStyle(accent) + '</style>' +
            '<span class="mi-err">miyagi-product: data-listing required</span>'
          return
        }

        fetchListing(listingId, key).then(function (listing) {
          var buyable = !!(listing.actions && listing.actions.buy_now)
          var inStock = listing.in_stock !== false
          var price = listing.price && listing.price.formatted ? listing.price.formatted : ''
          var img = listing.images && listing.images[0] ? listing.images[0].url : ''
          var cond = conditionLabel(locale, listing.condition)
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
          root.innerHTML = '<style>' + cardStyle(accent) + '</style>' +
            '<span class="mi-err">' + esc(t(locale, 'error')) + '</span>'
        })
      }
    })
  }

  defineBuyButton()
  defineProductCard()
  defineSupportWidget()
})()
