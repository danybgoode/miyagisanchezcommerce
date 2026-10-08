import { normalizedClaimEmail } from './claim-invitation.ts'

/** Clerk may create an account before its mailbox has been verified. */
export function verifiedWelcomeEmail(rows: readonly {
  email_address?: string
  verification?: { status?: string }
}[]): string | null {
  for (const row of rows) {
    if (row.verification?.status !== 'verified') continue
    const email = normalizedClaimEmail(row.email_address)
    if (email) return email
  }
  return null
}
