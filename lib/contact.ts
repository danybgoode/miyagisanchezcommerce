/**
 * lib/contact.ts
 *
 * The ONE place the platform's human contact address is written down.
 *
 * It already existed in `lib/email.ts` as `REPLY_TO`, set at the single email
 * transport so all 63 senders inherit it — but that is a server-only module
 * that pulls in Resend, Clerk and the whole notification log, so nothing on the
 * client could reference it. The address was therefore reachable only by
 * replying to an email we had already sent you: a visitor with a question, and
 * anyone who had never received one, had no way to reach a person at all.
 *
 * Deliberately dependency-free so both a Server Component and a Client
 * Component can import it, and so `lib/email.ts` can take it from here rather
 * than keeping a second copy. A paraphrased contract drifts; an address that
 * appears in two files eventually appears as two addresses, and the wrong half
 * of that pair is a support channel nobody is reading.
 */

/** Where a human answers. Also the Reply-To on every email the platform sends. */
export const CONTACT_EMAIL = 'hola@miyagisanchez.com'

/** `mailto:` with an optional prefilled subject, so a page can say what it is about. */
export function contactMailto(subject?: string): string {
  return subject
    ? `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`
    : `mailto:${CONTACT_EMAIL}`
}
