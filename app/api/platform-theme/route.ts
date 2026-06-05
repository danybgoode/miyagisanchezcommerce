import { NextResponse, type NextRequest } from 'next/server'
import { getPlatformThemePayload, isPlatformThemeEligiblePath } from '@/lib/platform-theme'

export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get('path')
  const payload = getPlatformThemePayload()

  return NextResponse.json({
    ...payload,
    eligible: path ? isPlatformThemeEligiblePath(path) : null,
    samples: {
      home: isPlatformThemeEligiblePath('/'),
      listings: isPlatformThemeEligiblePath('/l'),
      listingDetail: isPlatformThemeEligiblePath('/l/prod_test'),
      agent: isPlatformThemeEligiblePath('/agent'),
      sellerStorefront: isPlatformThemeEligiblePath('/s/test-shop'),
      embed: isPlatformThemeEligiblePath('/embed/s/test-shop'),
      checkout: isPlatformThemeEligiblePath('/checkout'),
      dashboard: isPlatformThemeEligiblePath('/shop/manage'),
      admin: isPlatformThemeEligiblePath('/admin'),
      account: isPlatformThemeEligiblePath('/account'),
    },
  })
}
