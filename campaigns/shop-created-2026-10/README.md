# Shop-created welcome · MX and US

These are unpublished Resend Templates for copy and layout review. The app sends the corresponding transactional HTML from `lib/email.ts` after a new owned shop is created; publishing a dashboard Template is not needed for delivery.

| Shop market | Resend review draft |
|---|---|
| MX · Spanish | [Open draft](https://resend.com/templates/bd1f402a-24e2-4518-8e98-b76f506d2fbb) |
| US · English | [Open draft](https://resend.com/templates/52262a09-62b2-486d-9b7f-5f62d6be3c62) |

The email names the shop, gives its public URL, and points the owner to the shop dashboard. Its feature list leads with merchant agents managing shop setup, products, offers, and orders, plus product discovery by buyer agents. It then covers listings, payment and delivery setup, orders, messages, and sharing. The creation paths `lib/ensure-shop.ts` and `app/api/sell/create/route.ts` register a delivery only for a new seller. A failed send stays pending and retries on the owner's next shop request or dashboard visit; an existing shop with no delivery record gets nothing. The language comes from Medusa's persisted `seller.metadata.operating_market`, never the browser locale. Unknown market is logged and skipped instead of guessed. Resend's `shop-created/<sellerId>` idempotency key protects concurrent attempts.

The Dashboard Templates use `SHOP_NAME` and `SHOP_URL` sample variables, and remain in draft status. No sample or merchant message was sent while preparing them.
