import 'server-only'

import { headers } from 'next/headers'
import {
  resolveShopPresentation,
  type ShopPresentationOptions,
} from './context'

/** Dynamic owned-host adapter; request-neutral public routes import context.ts directly. */
export async function resolveRequestShopPresentation(
  slug: string | null,
  options: ShopPresentationOptions = {},
) {
  const requestHeaders = await headers()
  return resolveShopPresentation(slug, {
    ...options,
    ownedShopSlug: requestHeaders.get('x-miyagi-shop-slug'),
  })
}
