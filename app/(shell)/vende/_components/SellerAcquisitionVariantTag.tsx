'use client'

import { useEffect } from 'react'
import type { SellerAcquisitionVariant } from '@/lib/seller-acquisition'

declare global {
  interface Window {
    clarity?: (command: 'set', key: string, value: string) => void
  }
}

type SellerAcquisitionVariantTagProps = {
  persona: string
  variant: SellerAcquisitionVariant
}

export function SellerAcquisitionVariantTag({
  persona,
  variant,
}: SellerAcquisitionVariantTagProps) {
  useEffect(() => {
    window.clarity?.('set', 'seller_acquisition_persona', persona)
    window.clarity?.('set', 'seller_acquisition_variant', variant)
    window.clarity?.('set', `seller_acquisition_${persona}_variant`, variant)
  }, [persona, variant])

  return null
}
