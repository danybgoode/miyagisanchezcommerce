'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  type CustomFieldDef,
  buildPersonalizationPayload,
  validatePersonalization,
  stashPersonalization,
  personalizationBuyLabels,
} from '@/lib/personalization'
import { checkoutHopHref, signInHopHref } from '@/lib/checkout-hop'
import PersonalizationFields, { type PersonalizationFieldsHandle } from './PersonalizationFields'

/**
 * PDP buy box for a personalizable product. Renders the custom fields *before*
 * the buy CTA (AC 2.1), gracefully intercepts a buy attempt with a missing
 * required field (focus + gentle hint, AC 2.3), and stashes the validated
 * payload so the checkout page can echo it and attach it to the line item.
 *
 * Only mounted when the listing actually has custom fields — non-personalized
 * products keep their original server-rendered CTA untouched.
 */
export default function PersonalizationBuyBox({
  listingId,
  defs,
  isSignedIn,
  customDomain,
  priceLabel,
  offerId,
  buyNowLabel,
  signInBuyLabel,
}: {
  listingId: string
  defs: CustomFieldDef[]
  isSignedIn: boolean
  customDomain: string | null
  priceLabel: string
  /** Present when buying at an accepted-offer price. */
  offerId?: string
  /** Override the default "Comprar ahora — $precio" CTA (e.g. an event's "Comprar boleto"). */
  buyNowLabel?: string
  /** Override the default signed-out CTA to match `buyNowLabel`. */
  signInBuyLabel?: string
}) {
  const router = useRouter()
  const fieldsRef = useRef<PersonalizationFieldsHandle>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [invalidFieldId, setInvalidFieldId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const checkoutPath = `/checkout?listingId=${encodeURIComponent(listingId)}`
    + (offerId ? `&offerId=${encodeURIComponent(offerId)}` : '')

  // Default "Comprar ahora — $precio" / "Inicia sesión…", overridden for an
  // event listing that's also personalized (so the CTA reads "Comprar boleto").
  const labels = personalizationBuyLabels(priceLabel, { buyNowLabel, signInBuyLabel })

  function onChange(id: string, value: string) {
    setValues(prev => ({ ...prev, [id]: value }))
    if (invalidFieldId === id && value.trim()) setInvalidFieldId(null)
  }

  function proceed() {
    const check = validatePersonalization(defs, values)
    if (!check.ok) {
      setInvalidFieldId(check.missingFieldId ?? null)
      if (check.missingFieldId) fieldsRef.current?.focusField(check.missingFieldId)
      return
    }
    setLoading(true)
    // Stash the validated payload — survives the same-tab nav to /checkout (and a
    // platform sign-in redirect). On a custom domain we hop to the platform host.
    stashPersonalization(listingId, buildPersonalizationPayload(defs, values))
    if (isSignedIn) {
      const href = checkoutHopHref(checkoutPath, customDomain)
      if (customDomain) window.location.href = href
      else router.push(href)
    } else {
      const href = signInHopHref(checkoutPath, customDomain)
      window.location.href = href
    }
  }

  return (
    <div>
      <PersonalizationFields
        ref={fieldsRef}
        defs={defs}
        values={values}
        onChange={onChange}
        invalidFieldId={invalidFieldId}
      />
      <button
        type="button"
        onClick={proceed}
        disabled={loading}
        className="flex items-center justify-center gap-2 w-full font-semibold py-3 rounded-xl text-sm disabled:opacity-60 transition-colors"
        style={{ background: 'var(--fg)', color: 'var(--fg-inverse)' }}
      >
        {loading ? (
          <span className="animate-spin inline-block">⟳</span>
        ) : isSignedIn ? (
          <>{labels.buyNow}</>
        ) : (
          <>{labels.signIn}</>
        )}
      </button>
    </div>
  )
}
