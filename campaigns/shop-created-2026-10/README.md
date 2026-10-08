# Shop-created welcome · MX and US

These are unpublished Resend Templates for copy and layout review. The app sends the corresponding transactional HTML from `lib/email.ts` after a new owned shop is created; publishing a dashboard Template is not needed for delivery.

| Shop market | Resend review draft |
|---|---|
| MX · Spanish | [Open draft](https://resend.com/templates/bd1f402a-24e2-4518-8e98-b76f506d2fbb) |
| US · English | [Open draft](https://resend.com/templates/52262a09-62b2-486d-9b7f-5f62d6be3c62) |

The email names the shop, gives its public URL, and points the owner to the shop dashboard. It describes listings, payment and delivery setup, orders, messages, and sharing. The first creation paths are `lib/ensure-shop.ts` and `app/api/sell/create/route.ts`; the idempotent existing-shop branch sends nothing. The language comes from Medusa's persisted `seller.metadata.operating_market`, never the browser locale. Unknown market and unavailable recipient are logged and skipped instead of guessed. Resend's `shop-created/<sellerId>` idempotency key protects a concurrent create retry.

The Dashboard Templates use `SHOP_NAME` and `SHOP_URL` sample variables, and remain in draft status. No sample or merchant message was sent while preparing them.
