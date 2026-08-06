import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import {
  approveAndInviteFoundingOperator,
  completeFoundingOperatorActivation,
  createFoundingOperatorInvitationMaterial,
  hashFoundingOperatorActivationToken,
  inspectFoundingOperatorActivation,
  partnerWorkspaceAdmitted,
  rotateAndResendFoundingOperatorInvitation,
  verifiedClerkEmailAddresses,
} from '../lib/founding-operator-activation'
import {
  approveFoundingOperatorApplication,
  recordFoundingOperatorInvitationOutcome,
  sanitizePromoterApplicationRow,
  type PromoterApplication,
} from '../lib/promoter-applications'
import { resolveFoundingOperatorInvitationOutcome } from '../lib/founding-operator-invitation-outcome'

const ROOT = process.cwd()
const APPLICATION: PromoterApplication = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Operator Example',
  email: 'operator@example.com',
  whatsapp: '+12125550100',
  city: null,
  motivation: null,
  status: 'approved',
  promoter_id: '00000000-0000-0000-0000-000000000002',
  program_track: 'founding_operator',
  operator_details_version: 1,
  operator_details: null,
  activation_expires_at: '2026-08-13T12:00:00.000Z',
  activation_used_at: null,
  invitation_provider_status: 'pending',
  invitation_attempt_count: 0,
  invitation_attempted_at: null,
  invitation_provider_accepted_at: null,
}
const MATERIAL = {
  token: 'a'.repeat(43),
  tokenHash: hashFoundingOperatorActivationToken('a'.repeat(43)),
  expiresAt: '2026-08-13T12:00:00.000Z',
}

test.describe('partners recruiting v3 · invitation material and principal', () => {
  test('mints 32 random bytes as base64url, lowercase SHA-256 and seven-day expiry', () => {
    const material = createFoundingOperatorInvitationMaterial(
      new Date('2026-08-06T12:00:00.000Z'),
      () => Buffer.alloc(32, 7),
    )
    expect(material.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(material.tokenHash).toMatch(/^[0-9a-f]{64}$/)
    expect(material.tokenHash).toBe(hashFoundingOperatorActivationToken(material.token))
    expect(material.expiresAt).toBe('2026-08-13T12:00:00.000Z')
  })

  test('passes only normalized Clerk-verified emails and admits tracks through their own flag', () => {
    expect(verifiedClerkEmailAddresses([
      { emailAddress: ' Operator@Example.com ', verification: { status: 'verified' } },
      { emailAddress: 'operator@example.com', verification: { status: 'verified' } },
      { emailAddress: 'other@example.com', verification: { status: 'unverified' } },
      { emailAddress: 'missing@example.com', verification: null },
    ])).toEqual(['operator@example.com'])
    expect(partnerWorkspaceAdmitted('founding_operator', false, true)).toBe(true)
    expect(partnerWorkspaceAdmitted('founding_operator', true, false)).toBe(false)
    expect(partnerWorkspaceAdmitted('promoter', true, false)).toBe(true)
    expect(partnerWorkspaceAdmitted('promoter', false, true)).toBe(false)
  })
})

test.describe('partners recruiting v3 · truthful provider outcomes', () => {
  test('email helper names only provider acceptance and executes ID/null/throw outcomes truthfully', async () => {
    const email = fs.readFileSync(path.join(ROOT, 'lib/email.ts'), 'utf8')
    const start = email.indexOf('export async function sendFoundingOperatorActivationInvitationWithOutcome')
    const helper = email.slice(start, email.indexOf('\n}\n', start) + 2)
    expect(start).toBeGreaterThan(0)
    expect(helper).toContain('resolveFoundingOperatorInvitationOutcome')
    expect(helper).not.toMatch(/delivered|delivery/i)

    await expect(resolveFoundingOperatorInvitationOutcome(async () => ' msg_123 '))
      .resolves.toEqual({ ok: true, providerMessageId: 'msg_123' })
    await expect(resolveFoundingOperatorInvitationOutcome(async () => null))
      .resolves.toEqual({ ok: false, kind: 'unconfirmed' })
    await expect(resolveFoundingOperatorInvitationOutcome(async () => { throw new Error('ambiguous provider result') }))
      .resolves.toEqual({ ok: false, kind: 'unconfirmed' })
  })

  test('approval commits before send and records only the matching material outcome', async () => {
    const events: string[] = []
    const result = await approveAndInviteFoundingOperator(APPLICATION.id, 'https://miyagisanchez.com', {
      createMaterial: () => MATERIAL,
      approve: async (_id, hash) => { events.push(`approve:${hash}`); return { ok: true, application: APPLICATION } },
      rotate: async () => ({ ok: false, reason: 'unavailable' }),
      sendInvitation: async ({ activationUrl }) => { events.push(`send:${activationUrl}`); return { ok: true, providerMessageId: 'msg_123' } },
      record: async (_id, hash, outcome) => { events.push(`record:${hash}:${outcome}`); return { ok: true, application: { ...APPLICATION, invitation_provider_status: outcome } } },
    })
    expect(result).toMatchObject({ ok: true, providerStatus: 'provider_accepted', outcomeRecorded: true })
    expect(events).toEqual([
      `approve:${MATERIAL.tokenHash}`,
      `send:https://miyagisanchez.com/partner/activate/${MATERIAL.token}`,
      `record:${MATERIAL.tokenHash}:provider_accepted`,
    ])
  })

  test('resend rotates before send and a failed outcome write leaves visible pending recovery', async () => {
    const events: string[] = []
    const result = await rotateAndResendFoundingOperatorInvitation(APPLICATION.id, 'https://miyagisanchez.com/', {
      createMaterial: () => MATERIAL,
      approve: async () => ({ ok: false, reason: 'unavailable' }),
      rotate: async (_id, hash) => { events.push(`rotate:${hash}`); return { ok: true, application: APPLICATION } },
      sendInvitation: async () => { events.push('send'); return { ok: false, kind: 'unconfirmed' } },
      record: async () => { events.push('record'); return { ok: false, reason: 'unavailable' } },
    })
    expect(events).toEqual([`rotate:${MATERIAL.tokenHash}`, 'send', 'record'])
    expect(result).toMatchObject({ ok: true, providerStatus: 'pending', outcomeRecorded: false })
  })
})

test.describe('partners recruiting v3 · activation and serialization', () => {
  test('RPC wrappers send exact hash-bound arguments and sanitize composite rows', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = []
    const deps = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args })
        return { data: { ...APPLICATION, activation_token_hash: 'never-serialize', code: 'MYP-SECRET' }, error: null }
      },
    }
    const approved = await approveFoundingOperatorApplication(APPLICATION.id, MATERIAL.tokenHash, MATERIAL.expiresAt, deps)
    const recorded = await recordFoundingOperatorInvitationOutcome(APPLICATION.id, MATERIAL.tokenHash, 'provider_accepted', deps)
    expect(approved.ok && JSON.stringify(approved.application)).not.toMatch(/never-serialize|MYP-SECRET/)
    expect(recorded.ok && JSON.stringify(recorded.application)).not.toMatch(/never-serialize|MYP-SECRET/)
    expect(calls).toEqual([
      {
        name: 'miyagi_approve_founding_operator_application',
        args: { p_application_id: APPLICATION.id, p_activation_token_hash: MATERIAL.tokenHash, p_activation_expires_at: MATERIAL.expiresAt },
      },
      {
        name: 'miyagi_record_founding_operator_invitation_outcome',
        args: { p_application_id: APPLICATION.id, p_activation_token_hash: MATERIAL.tokenHash, p_provider_outcome: 'provider_accepted' },
      },
    ])
  })

  test('RPC transition errors stay distinct from unavailable infrastructure', async () => {
    const call = (code: string, message: string) => approveFoundingOperatorApplication(
      APPLICATION.id,
      MATERIAL.tokenHash,
      MATERIAL.expiresAt,
      { rpc: async () => ({ data: null, error: { code, message } }) },
    )
    await expect(call('P0002', 'application_not_found')).resolves.toEqual({ ok: false, reason: 'not_found' })
    await expect(call('55000', 'invalid_application_transition')).resolves.toEqual({ ok: false, reason: 'invalid_transition' })
    await expect(call('08006', 'connection_failure')).resolves.toEqual({ ok: false, reason: 'unavailable' })
  })

  test('GET inspection is read-only and classifies ready, expired, used and invalid', async () => {
    const token = 'b'.repeat(43)
    const inspect = (data: unknown) => inspectFoundingOperatorActivation(token, new Date('2026-08-06T12:00:00.000Z'), {
      findByHash: async (hash) => {
        expect(hash).toBe(hashFoundingOperatorActivationToken(token))
        return { data, error: null }
      },
    })
    await expect(inspect({ program_track: 'founding_operator', status: 'approved', activation_expires_at: '2026-08-07T12:00:00.000Z', activation_used_at: null })).resolves.toBe('ready')
    await expect(inspect({ program_track: 'founding_operator', status: 'approved', activation_expires_at: '2026-08-05T12:00:00.000Z', activation_used_at: null })).resolves.toBe('expired')
    await expect(inspect({ program_track: 'founding_operator', status: 'approved', activation_expires_at: '2026-08-07T12:00:00.000Z', activation_used_at: '2026-08-06T11:00:00.000Z' })).resolves.toBe('used')
    await expect(inspect({ program_track: 'promoter', status: 'approved' })).resolves.toBe('invalid')
    await expect(inspectFoundingOperatorActivation(token, new Date(), {
      findByHash: async () => ({ data: null, error: new Error('database unavailable') }),
    })).resolves.toBe('unavailable')
    await expect(inspectFoundingOperatorActivation('bad')).resolves.toBe('invalid')
  })

  test('POST hashes the token and passes only verified emails to the RPC', async () => {
    const token = 'c'.repeat(43)
    const result = await completeFoundingOperatorActivation(token, 'user_123', [
      { emailAddress: 'Operator@Example.com', verification: { status: 'verified' } },
      { emailAddress: 'wrong@example.com', verification: { status: 'unverified' } },
    ], {
      activate: async (hash, clerkUserId, verifiedEmails) => {
        expect(hash).toBe(hashFoundingOperatorActivationToken(token))
        expect(clerkUserId).toBe('user_123')
        expect(verifiedEmails).toEqual(['operator@example.com'])
        return { ok: true, application: APPLICATION }
      },
    })
    expect(result.ok).toBe(true)
  })

  test('sanitized RPC rows cannot serialize token hashes or internal identity codes', () => {
    const sanitized = sanitizePromoterApplicationRow({
      ...APPLICATION,
      activation_token_hash: 'secret-hash',
      code: 'MYP-INTERNAL',
    })
    expect(sanitized).not.toBeNull()
    expect(JSON.stringify(sanitized)).not.toMatch(/secret-hash|activation_token_hash|MYP-INTERNAL|"code"/)
  })

  test('routes gate activation, preserve an audited resend, and use one Clerk binding writer', () => {
    const approve = fs.readFileSync(path.join(ROOT, 'app/api/admin/promoter/applications/[id]/approve/route.ts'), 'utf8')
    const resendPath = path.join(ROOT, 'app/api/admin/promoter/applications/[id]/resend/route.ts')
    const activationApiPath = path.join(ROOT, 'app/api/partner/activate/[token]/route.ts')
    const activationPagePath = path.join(ROOT, 'app/(shell)/partner/activate/[token]/page.tsx')
    const promoter = fs.readFileSync(path.join(ROOT, 'lib/promoter.ts'), 'utf8')
    expect(approve).toContain('approveAndInviteFoundingOperator')
    expect(fs.existsSync(resendPath)).toBe(true)
    expect(fs.existsSync(activationApiPath)).toBe(true)
    expect(fs.existsSync(activationPagePath)).toBe(true)
    const resend = fs.readFileSync(resendPath, 'utf8')
    const activationApi = fs.readFileSync(activationApiPath, 'utf8')
    const activationPage = fs.readFileSync(activationPagePath, 'utf8')
    expect(resend).toContain('withAdmin')
    expect(resend).toContain('rotateAndResendFoundingOperatorInvitation')
    expect(activationApi).toContain('recruitingV3Enabled()')
    expect(activationApi).toContain("verification?.status === 'verified'")
    expect(activationPage).toContain('inspectFoundingOperatorActivation')
    expect(activationPage).toContain('Array.isArray(rawStatus) ? rawStatus[0] : rawStatus')
    expect(promoter).toContain("db.rpc('miyagi_bind_partner_identity'")
    expect(promoter).not.toContain('.update({ clerk_user_id: clerkUserId })')
  })

  test('workspace branches on track without exposing MYP codes or operator administer shortcuts', () => {
    const page = fs.readFileSync(path.join(ROOT, 'app/(shell)/partner/page.tsx'), 'utf8')
    expect(page).toContain('partnerWorkspaceAdmitted')
    expect(page).toContain("promoter.program_track === 'founding_operator'")
    expect(page).toContain('Founding Commerce Operator')
    expect(page).toContain('{!foundingOperator && promoter ? (')
    expect(page).toContain("!foundingOperator && <Link href=\"/shop/manage\"")
  })
})
