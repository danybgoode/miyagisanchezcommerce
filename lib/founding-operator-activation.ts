import { createHash, randomBytes } from 'node:crypto'
import { db } from '@/lib/supabase'
import {
  activateFoundingOperator,
  approveFoundingOperatorApplication,
  recordFoundingOperatorInvitationOutcome,
  rotateFoundingOperatorInvitation,
  type FoundingOperatorMutationResult,
  type PromoterApplication,
  type ProgramTrack,
} from '@/lib/promoter-applications'
import type { FoundingOperatorInvitationOutcome } from '@/lib/email'

const ACTIVATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000

export interface InvitationMaterial {
  token: string
  tokenHash: string
  expiresAt: string
}

export function hashFoundingOperatorActivationToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function isFoundingOperatorActivationToken(value: unknown): value is string {
  return typeof value === 'string' && ACTIVATION_TOKEN_PATTERN.test(value)
}

export function createFoundingOperatorInvitationMaterial(
  now = new Date(),
  randomSecret: () => Buffer = () => randomBytes(32),
): InvitationMaterial {
  const token = randomSecret().toString('base64url')
  if (!isFoundingOperatorActivationToken(token)) throw new Error('invalid_activation_secret')
  return {
    token,
    tokenHash: hashFoundingOperatorActivationToken(token),
    expiresAt: new Date(now.getTime() + INVITATION_LIFETIME_MS).toISOString(),
  }
}

export function verifiedClerkEmailAddresses(
  emailAddresses: Array<{ emailAddress?: string | null; verification?: { status?: string | null } | null }>,
): string[] {
  return [...new Set(emailAddresses
    .filter((entry) => entry.verification?.status === 'verified')
    .map((entry) => entry.emailAddress?.trim().toLowerCase() ?? '')
    .filter(Boolean))]
}

export function partnerWorkspaceAdmitted(
  track: ProgramTrack | null,
  partnerMcpEnabled: boolean,
  recruitingEnabled: boolean,
): boolean {
  return track === 'founding_operator' ? recruitingEnabled : partnerMcpEnabled
}

type InvitationFlowDeps = {
  createMaterial: () => InvitationMaterial
  approve: typeof approveFoundingOperatorApplication
  rotate: typeof rotateFoundingOperatorInvitation
  record: typeof recordFoundingOperatorInvitationOutcome
  sendInvitation: (ctx: { to: string; name: string; activationUrl: string; expiresAt: string }) => Promise<FoundingOperatorInvitationOutcome>
}

const invitationFlowDeps: InvitationFlowDeps = {
  createMaterial: createFoundingOperatorInvitationMaterial,
  approve: approveFoundingOperatorApplication,
  rotate: rotateFoundingOperatorInvitation,
  record: recordFoundingOperatorInvitationOutcome,
  // Keep the pure activation seam importable in deterministic tests; `lib/email`
  // loads the app's JSON locale bundle and is needed only on the real send path.
  sendInvitation: async (ctx) => {
    const { sendFoundingOperatorActivationInvitationWithOutcome } = await import('@/lib/email')
    return sendFoundingOperatorActivationInvitationWithOutcome(ctx)
  },
}

export type InvitationFlowResult =
  | {
    ok: true
    application: PromoterApplication
    providerStatus: 'pending' | 'provider_accepted' | 'unconfirmed'
    outcomeRecorded: boolean
  }
  | Extract<FoundingOperatorMutationResult, { ok: false }>

async function sendAndRecordInvitation(
  application: PromoterApplication,
  material: InvitationMaterial,
  siteOrigin: string,
  deps: InvitationFlowDeps,
): Promise<Extract<InvitationFlowResult, { ok: true }>> {
  let sendOutcome: FoundingOperatorInvitationOutcome
  try {
    sendOutcome = await deps.sendInvitation({
      to: application.email,
      name: application.name,
      activationUrl: `${siteOrigin.replace(/\/$/, '')}/partner/activate/${material.token}`,
      expiresAt: material.expiresAt,
    })
  } catch {
    sendOutcome = { ok: false, kind: 'unconfirmed' }
  }
  const providerStatus = sendOutcome.ok ? 'provider_accepted' : 'unconfirmed'
  const recorded = await deps.record(application.id, material.tokenHash, providerStatus)
  return recorded.ok
    ? { ok: true, application: recorded.application, providerStatus, outcomeRecorded: true }
    : { ok: true, application, providerStatus: 'pending', outcomeRecorded: false }
}

/** Approval commits before email; every post-commit outcome remains recoverable. */
export async function approveAndInviteFoundingOperator(
  applicationId: string,
  siteOrigin: string,
  deps: InvitationFlowDeps = invitationFlowDeps,
): Promise<InvitationFlowResult> {
  const material = deps.createMaterial()
  const approved = await deps.approve(applicationId, material.tokenHash, material.expiresAt)
  if (!approved.ok) return approved
  return sendAndRecordInvitation(approved.application, material, siteOrigin, deps)
}

/** Rotation commits before another send, invalidating every older link first. */
export async function rotateAndResendFoundingOperatorInvitation(
  applicationId: string,
  siteOrigin: string,
  deps: InvitationFlowDeps = invitationFlowDeps,
): Promise<InvitationFlowResult> {
  const material = deps.createMaterial()
  const rotated = await deps.rotate(applicationId, material.tokenHash, material.expiresAt)
  if (!rotated.ok) return rotated
  return sendAndRecordInvitation(rotated.application, material, siteOrigin, deps)
}

export type ActivationInspection = 'ready' | 'invalid' | 'expired' | 'used' | 'unavailable'

type ActivationInspectionDeps = {
  findByHash: (tokenHash: string) => Promise<{ data: unknown; error: unknown }>
}
const activationInspectionDeps: ActivationInspectionDeps = {
  findByHash: async (tokenHash) => db.from('marketplace_promoter_applications')
    .select('status, program_track, activation_expires_at, activation_used_at')
    .eq('activation_token_hash', tokenHash)
    .maybeSingle(),
}

export async function inspectFoundingOperatorActivation(
  token: unknown,
  now = new Date(),
  deps: ActivationInspectionDeps = activationInspectionDeps,
): Promise<ActivationInspection> {
  if (!isFoundingOperatorActivationToken(token)) return 'invalid'
  const { data, error } = await deps.findByHash(hashFoundingOperatorActivationToken(token))
  // An unreadable database is not evidence that a token is absent. Keep the
  // operational gap distinct so the page can fail closed without lying.
  if (error) return 'unavailable'
  if (typeof data !== 'object' || data === null) return 'invalid'
  const row = data as Record<string, unknown>
  if (row.program_track !== 'founding_operator' || row.status !== 'approved') return 'invalid'
  if (typeof row.activation_used_at === 'string') return 'used'
  if (typeof row.activation_expires_at !== 'string' || new Date(row.activation_expires_at).getTime() <= now.getTime()) return 'expired'
  return 'ready'
}

type ActivationDeps = { activate: typeof activateFoundingOperator }

export async function completeFoundingOperatorActivation(
  token: unknown,
  clerkUserId: string,
  emailAddresses: Array<{ emailAddress?: string | null; verification?: { status?: string | null } | null }>,
  deps: ActivationDeps = { activate: activateFoundingOperator },
): Promise<FoundingOperatorMutationResult> {
  if (!isFoundingOperatorActivationToken(token) || !clerkUserId) return { ok: false, reason: 'not_found' }
  const verifiedEmails = verifiedClerkEmailAddresses(emailAddresses)
  if (verifiedEmails.length === 0) return { ok: false, reason: 'invalid_transition' }
  return deps.activate(hashFoundingOperatorActivationToken(token), clerkUserId, verifiedEmails)
}
