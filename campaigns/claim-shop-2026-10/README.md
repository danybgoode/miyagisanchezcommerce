# Claim your public shop — campaign copy for review

**State:** Draft only. No campaign messages or contacts have been sent or imported by this epic. The MX/US copy is local and is also available as unpublished Resend Templates for Daniel's review.

## Resend review drafts

These are **Templates**, not Broadcasts. They have no recipient segment and cannot send while unpublished. The invitation Templates are for copy review only; Resend's opt-in policy still rules out sending this public-address campaign through Resend. The app renders and sends transaction-email HTML from `lib/email.ts`. Daniel chose to keep app code as the source. The MX shop-claimed headline in code and its unpublished Dashboard draft both include the shop name; the new-account draft's copy was left as approved. His `@miyagisanchez.com` Gmail send-as path also uses Resend SMTP, so Gmail composition does not make the cold campaign eligible for that transport.

| Review copy | Resend draft |
|---|---|
| Merchant invitation · MX | [Open draft](https://resend.com/templates/ce7a30bb-68c0-40fa-aea5-65a560a7acb4) |
| Merchant invitation · US | [Open draft](https://resend.com/templates/83f3085a-b7a0-4ada-90c4-e3f909742b97) |
| New account welcome · bilingual | [Open draft](https://resend.com/templates/7751c4d3-3a3f-4d63-b72f-82ee4ea953e9) |
| Shop claimed · MX | [Open draft](https://resend.com/templates/a5449c6c-04ca-4349-9416-f60df7ad2d4e) |
| Shop claimed · US | [Open draft](https://resend.com/templates/ec845b7f-4857-48bf-8719-53293464803b) |

The legacy claim-request receipt still exists in code for old API callers but is no longer part of the public claim journey. There is no automated campaign follow-up sequence.

**Sending channel:** The planned public-address outreach is unsolicited. [Resend's current Acceptable Use Policy](https://resend.com/legal/acceptable-use) prohibits cold outreach and requires explicit recipient opt-in. Resend remains the app's transport for account and claim transaction emails, but this campaign cannot be sent as a Resend Broadcast to the researched public addresses. A Dashboard copy, if created for review, is review-only. Select a channel that permits this outreach and meets applicable requirements before preparing a sendable list. If a merchant has explicitly opted in, record that consent before considering a Resend Broadcast.

The source workbook `references/leads-gems.xlsx` contains 50 prospect rows, **no email addresses**, and no confirmed mapping to a currently public Miyagi shop. `research-queue.csv` preserves all 50 leads as a research queue. Curators and market networks are marked for partnership or further research; they are not assumed to own a Miyagi shop. This file is deliberately **not** a Resend import list.

## Before using a row

1. Find a public `/mx/s/{slug}` or `/us/s/{slug}` listing for the exact merchant. Confirm it is unclaimed and active in Medusa. A website URL in the workbook alone does not establish a Miyagi listing.
2. Find the merchant's contact address from a public business source, record that source in `contact_provenance`, and remove duplicates and opt-outs. Do not use a curator's address as the merchant's. A public address is not evidence of consent for Resend.
3. Open `/admin/claim-campaign`, enter the shop, market, outreach email and where you found it, then create the two links. The page uses `POST /api/admin/claim-invitations` with `campaignId: "claim-shop-2026-10"`; it returns shop-specific claim and removal links and **does not send** an email. The links do not expire. Anyone who has the claim link may sign in with any account and claim the still-public, unclaimed shop. Insert both URLs into the correct shop's draft.
4. Daniel edits the subject/body, checks each unique claim URL and removal URL, and adds the valid sender postal address and unsubscribe method required by the eventual sending channel. He sends only after choosing that channel and reviewing the final copy and recipients.

For an explicitly opted-in audience, Resend Broadcasts support editable dashboard drafts, contact properties, segments, unsubscribe handling, and delivery/click reporting. Use Resend's unsubscribe footer or `{{{RESEND_UNSUBSCRIBE_URL}}}` in an API-authored Broadcast. API-authored and visual-editor Broadcasts cannot be edited interchangeably, so create it in the dashboard if Daniel needs to edit there. Do not import the research queue into Resend.

## Measurement

Use one campaign id (`claim-shop-2026-10`) in every invitation. The admin `GET /api/admin/claim-campaign/report?campaignId=claim-shop-2026-10` route counts issued invitations, completed claims and removal requests from durable receipts. The eventual sending channel should report deliveries and clicked links if available; Resend can do this for an opted-in Broadcast. Golden Frijoles already receives `merchant.claimed` after ownership transfer and now receives claim attempts, completions and removals. Events include campaign id and shop id only; never send email, contact name or JWT to Golden. Compare unique claim-link clickers, when available, with successful Medusa transfers and Golden accepted events. Treat unavailable delivery or Golden data as unavailable, never zero conversion.

No live production shop data was accessible from this checkout, so the 50 leads are not eligible for an actual send yet. The app's configured Resend API key has send-only scope; the separate CLI login was used to create the review drafts. No Supabase migration was applied here.
