/**
 * lib/copy-overrides-sections.ts
 *
 * ONE definition of "which section does this key belong to" for
 * `/admin/contenido`. Three separate files used to spell the same rule
 * (`key.split('.')[0]`) inline — `copy-overrides-admin-view.ts`'s
 * `filterKeysBySection`, `copy-overrides-page-nav.ts`'s `buildPageNavGroups`,
 * and `copy-overrides-routes.ts`'s `routeForKey`. A rule restated in three
 * places is a rule that forks, and the nav filtering only works while all
 * three agree, so it lives here now and they all call it.
 *
 * ── Why a namespace-dependent rule at all ────────────────────────────────────
 * `key.split('.')[0]` is right for every HAND-AUTHORED namespace, where the
 * first segment genuinely names a page or a surface (`autos.heroTitle`,
 * `hero.heading`). It is catastrophically wrong for `sellerCopy`, whose 1809
 * keys are content hashes of the original string (`s_003eaeb84959eda1`,
 * produced by `scripts/derive-seller-locale-population.ts`) with no dots at
 * all. Under the old rule EVERY one of those keys became its own section, so
 * the editor's left-hand nav rendered 1809 entries, each one resolving to no
 * route and therefore captioned "sección no reconocida — revisar
 * lib/copy-overrides-routes.ts". That is the bug this file exists to fix:
 * an unusable nav that also accused itself of being broken, ~2600 times.
 *
 * For `sellerCopy` the meaningful grouping is the PAGE the string renders on,
 * and that fact is already recorded: `locales/seller-population.json` (the
 * checked-in output of the same derive script) maps every key to the source
 * file it was extracted from. Collapsing those 105 files to their route
 * directories yields ~33 real seller-portal pages — a nav a human can use.
 *
 * ── Three states, never two ──────────────────────────────────────────────────
 * A `sellerCopy` key that is in `locales/es.json` but NOT in the population
 * file is a real drift signal (the dictionary was hand-edited, or the
 * population file went stale). It does not silently vanish and it does not
 * silently join a real page: it lands in `UNMAPPED_SELLER_SECTION`, which is a
 * recognized section with a real route description. `e2e/copy-overrides-route-
 * coverage.spec.ts` asserts that section is EMPTY against the live dictionary,
 * so drift is loud rather than absent.
 */
import sellerPopulation from '@/locales/seller-population.json' with { type: 'json' }

/**
 * The section every `sellerCopy` key falls into when the population file
 * doesn't know it. A real, nameable bucket — not `null`, and not silently
 * folded into a neighbouring page.
 */
export const UNMAPPED_SELLER_SECTION = '__unmapped__'

/** Namespaces whose keys are content hashes, so the section comes from the source file. */
const FILE_DERIVED_NAMESPACES = new Set(['sellerCopy'])

/**
 * `app/(shell)/shop/manage/orders/[id]/OrderDetail.tsx` → `shop/manage/orders/[id]`.
 *
 * Drops the filename (a component and the `page.tsx` beside it render on the
 * same page, so they belong in the same group), the `app/` prefix, and Next's
 * route groups — `(shell)`, `(onboarding)`, `(site)` are organisational, not
 * URL segments, which is exactly why they must not become nav groups either.
 *
 * `_components`/`_sections` directories are private co-location folders, not
 * routes: their contents render inside the parent page, so they collapse into
 * it rather than becoming a phantom destination the merchant cannot visit.
 */
export function pageDirForSourceFile(file: string): string {
  const withoutFile = file.replace(/\/[^/]+$/, '')
  const segments = withoutFile
    .split('/')
    .filter((segment) => segment !== 'app')
    // A route group is a whole segment wrapped in parens — never a partial match.
    .filter((segment) => !/^\(.*\)$/.test(segment))
    // Private folders render inside their parent, so they ARE their parent.
    .filter((segment) => !segment.startsWith('_'))
  return segments.join('/')
}

/** key → page directory, built once from the checked-in population artifact. */
const sellerPageByKey: ReadonlyMap<string, string> = new Map(
  sellerPopulation.files.flatMap((entry) =>
    entry.keys.map((key) => [key, pageDirForSourceFile(entry.file)] as const),
  ),
)

/**
 * The section a key belongs to, for grouping AND for filtering. Both must use
 * this — a nav that groups one way while the filter narrows another way shows
 * a group whose contents are empty.
 */
export function sectionForKey(namespace: string, key: string): string {
  if (FILE_DERIVED_NAMESPACES.has(namespace)) {
    return sellerPageByKey.get(key) ?? UNMAPPED_SELLER_SECTION
  }
  return key.split('.')[0] || key
}

/** Every distinct section the live dictionary produces for one namespace — the coverage guard's input. */
export function sectionsForNamespace(
  keys: readonly { namespace: string; key: string }[],
  namespace: string,
): string[] {
  const found = new Set<string>()
  for (const k of keys) {
    if (k.namespace === namespace) found.add(sectionForKey(k.namespace, k.key))
  }
  return [...found].sort()
}
