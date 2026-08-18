import 'server-only'

/**
 * Living Shop — the owner-only preview overlay (epic 07, Story 5.5).
 *
 * The studio previews the REAL public shop in an iframe, passing the pending
 * configuration as query parameters. One visual implementation, no second
 * renderer to drift — which is the whole point of Story 5.5.
 *
 * 🚨 THE RULE THIS MODULE EXISTS TO ENFORCE: the public shop never renders
 * unsaved state for anybody but the owner. So the overlay applies ONLY when the
 * Clerk session owns this shop, proven server-side against
 * `marketplace_shops.clerk_user_id`. Without that check, a shared link carrying
 * `?theme_mode=retro` would let anyone repaint any merchant's storefront for any
 * visitor who followed it — and a crawler could index it.
 *
 * It is also non-destructive by construction: nothing here writes. The overlay
 * lives for exactly one request.
 */

import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { normalizeSections } from './sections'
import { validateRecipe, THEME_MODES } from './theme'

export interface PreviewOverlay {
  theme_mode?: string
  theme_recipe?: unknown
  sections?: unknown
}

/**
 * Merge a pending draft over persisted settings, but only for the shop's owner.
 *
 * Returns the settings unchanged for everyone else — including a signed-in user
 * who owns a DIFFERENT shop, which is the case an ownership check written as
 * "is signed in" would get wrong.
 */
export async function applyPreviewOverlay(
  slug: string,
  settings: Record<string, unknown>,
  params: Record<string, string | string[] | undefined>,
): Promise<Record<string, unknown>> {
  if (params.preview !== '1') return settings

  const { userId } = await auth()
  if (!userId) return settings

  // Ownership, by the slug being rendered — not by "does this user own a shop".
  const { data } = await db
    .from('marketplace_shops')
    .select('id')
    .eq('slug', slug)
    .eq('clerk_user_id', userId)
    .maybeSingle()
  if (!data) return settings

  const overlay: Record<string, unknown> = { ...settings }

  const mode = typeof params.theme_mode === 'string' ? params.theme_mode : null
  if (mode && (THEME_MODES as readonly string[]).includes(mode)) overlay.theme_mode = mode

  // Every draft value goes through the SAME validators the write path uses. A
  // preview that accepted something the save would refuse is a preview that
  // lies, which is worse than no preview at all.
  const recipeRaw = typeof params.theme_recipe === 'string' ? safeJson(params.theme_recipe) : null
  if (recipeRaw !== null) {
    const result = validateRecipe(recipeRaw)
    if (result.ok) overlay.theme_recipe = result.value
  }

  const sectionsRaw = typeof params.sections === 'string' ? safeJson(params.sections) : null
  if (sectionsRaw !== null) overlay.sections = normalizeSections(sectionsRaw)

  return overlay
}

function safeJson(value: string): unknown {
  // A malformed draft is ignored, not thrown: the preview should degrade to the
  // saved shop rather than showing the merchant an error page.
  if (value.length > 4000) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}
