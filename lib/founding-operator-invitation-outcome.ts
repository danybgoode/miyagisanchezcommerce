export type FoundingOperatorInvitationOutcome =
  | { ok: true; providerMessageId: string }
  | { ok: false; kind: 'unconfirmed' }

/**
 * Turn the provider call into the only truth the application records. A
 * non-empty acceptance ID is success; every missing or ambiguous result is
 * recoverable and explicitly unconfirmed.
 */
export async function resolveFoundingOperatorInvitationOutcome(
  sendEmail: () => Promise<string | null>,
): Promise<FoundingOperatorInvitationOutcome> {
  try {
    const providerMessageId = (await sendEmail())?.trim()
    return providerMessageId
      ? { ok: true, providerMessageId }
      : { ok: false, kind: 'unconfirmed' }
  } catch {
    return { ok: false, kind: 'unconfirmed' }
  }
}
