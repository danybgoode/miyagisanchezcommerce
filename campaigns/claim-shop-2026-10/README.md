# Claim your public shop — editable campaign draft

**State:** Draft only. No campaign messages or contacts have been sent or imported into Resend.

The source workbook `references/leads-gems.xlsx` contains 50 prospect rows, **no email addresses**, and no confirmed mapping to a currently public Miyagi shop. `research-queue.csv` preserves all 50 leads as a research queue. Curators and market networks are marked for partnership or further research; they are not assumed to own a Miyagi shop. This file is deliberately **not** a Resend import list.

## Before using a row

1. Find a public `/mx/s/{slug}` or `/us/s/{slug}` listing for the exact merchant. Confirm it is unclaimed and active in Medusa. A website URL in the workbook alone does not establish a Miyagi listing.
2. Find the merchant's contact address from a public business source, record that source in `contact_provenance`, and remove duplicates and unsubscribed contacts. Do not use a curator's address as the merchant's.
3. Open `/admin/claim-campaign`, enter the shop, market, contact email and where you verified it, then create the two links. The page uses `POST /api/admin/claim-invitations` with `campaignId: "claim-shop-2026-10"`; it returns recipient-bound, 14-day `claimUrl` and `removalUrl` values and **does not send** an email. Insert both unique URLs into the contact's draft.
4. Build a separate Resend segment for `mx` and `us`. Keep the Broadcast in draft. Daniel edits the subject/body, checks each unique claim URL and removal URL, adds the valid sender postal address and Resend unsubscribe footer, and sends from the dashboard when ready.

Resend Broadcasts support editable dashboard drafts, contact properties, segments, unsubscribe handling, and delivery/click reporting. Use Resend's unsubscribe footer or `{{{RESEND_UNSUBSCRIBE_URL}}}` in an API-authored Broadcast. API-authored and visual-editor Broadcasts cannot be edited interchangeably, so the dashboard editor is the simplest handoff for Daniel.

## Measurement

Use one campaign id (`claim-shop-2026-10`) in every invitation. The admin `GET /api/admin/claim-campaign/report?campaignId=claim-shop-2026-10` route counts issued invitations, completed claims and removal requests from durable receipts. Resend reports accepted/delivered, bounced, unsubscribed, and clicked links after a send. Golden Frijoles already receives `merchant.claimed` after ownership transfer and now receives claim attempts, completions and removals. Events include campaign id and shop id only; never send email, contact name or JWT to Golden. Compare unique Resend claim-link clickers with successful Medusa transfers and Golden accepted events. Treat an unavailable Golden account or webhook as unavailable, never zero conversion.

No live production data or Resend audience was accessible from this checkout, so the 50 leads are not eligible for an actual send yet. No Supabase migration was applied here.
