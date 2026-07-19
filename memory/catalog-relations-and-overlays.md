# Catalog relations and body-level overlays

_Recorded 2026-07-19 after backend PR #104 and frontend PRs #285/#286._

## Seller ↔ product relations

- An empty shop projection is not proof of a missing link. Validate both relationship directions
  before mutating production data.
- Medusa seller→products reads can contain `null` slots when linked products are soft-deleted.
  Backend reads must use the shared typed resolver/normalizer instead of mapping `products`
  directly.
- Historical authorization (orders, tickets, or any durable product reference) must include
  deleted products. In the installed Medusa query layer that requires the nested relation's own
  `QueryContext({})`; a top-level deleted-inclusive option does not widen the nested relation.
- Ownership checks fail closed: empty, unresolved, mixed-seller, and relation-query-error cases are
  unauthorized. For orders, the seller must own every resolvable item.
- Public catalog checks must inspect every advertised item across every page. Skip only when the
  catalog is genuinely empty; never skip because an invariant value such as `shop.slug` is empty.

The production incident that established these rules was not an orphan listing. Product
`prod_01KXGXMQ3X6WPMGDG2BMP64H7K` had an active link to shop `andrea-shops`; eight soft-deleted
sibling products created sparse slots, and the old listings read discarded the seller's complete
attribution map after the exception. No product was unpublished.

## Full-screen overlays in the platform shell

`.platform-main-shell` is an isolated stacking context below the root header. A fixed overlay
mounted inside it cannot rise above root-level chrome by increasing `z-index`. Portal immersive
buyer-shell overlays to `document.body`, use the named overlay layer, and prove the close control
with a real click/hit test.

When a mobile-only body-level overlay locks scroll, also handle the breakpoint transition while it
is open. The 390→800 regression is the useful fixture: the overlay must close and remove its body
cleanup when the media query changes.

Four audited `/shop/manage/*` overlays live under the separate seller shell and did not share this
stacking failure; do not churn them solely because they use `fixed inset-0`.

## Pointers and remaining human checks

- Backend: `src/api/store/_utils/seller-catalog-query.ts` and its AST inventory guard.
- Frontend: `app/(shell)/l/[id]/Gallery.tsx`, the mobile catalog filter portal, and
  `e2e/embed-shop.spec.ts`.
- Shipped refs: backend #104 (`f813206`), frontend #285 (`ca702d3`), frontend #286 (`b1a8311`).
- Still owed: installed-PWA safe-area/theme judgment; authenticated Make Offer; deleted-listing
  order authorization and ticket redemption on disposable production data.
