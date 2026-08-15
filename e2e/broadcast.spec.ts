import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BROADCAST_CONFIRM_PHRASE,
  BROADCAST_MAX_RECIPIENTS,
  bodyParagraphs,
  decideBroadcastDraft,
  decideBroadcastSend,
} from '../lib/notifications/broadcast'

/**
 * The admin broadcast is the only surface in the product that mails every user at
 * once. Every assertion below is a REFUSAL or the absence of one, because that is
 * what these functions are for: they run before the transport is touched, so a
 * rejected broadcast cannot half-send.
 */

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8')

const draft = (over: Record<string, unknown> = {}) => ({
  audience: 'sellers',
  subject: 'Ya quedó resuelto',
  headline: 'Los correos de pedidos ya funcionan',
  body: 'Encontramos y corregimos una falla en el envío de correos. Ya puedes seguir como siempre.',
  ...over,
})

test.describe('decideBroadcastDraft', () => {
  test('accepts a well-formed draft and trims it', () => {
    const d = decideBroadcastDraft(draft({ subject: '  Ya quedó resuelto  ' }))
    expect(d.ok).toBe(true)
    if (d.ok) expect(d.draft.subject).toBe('Ya quedó resuelto')
  })

  test('REFUSES an unknown audience, naming the allowed set', () => {
    const d = decideBroadcastDraft(draft({ audience: 'todos' }))
    expect(d.ok).toBe(false)
    if (!d.ok) {
      expect(d.field).toBe('audience')
      expect(d.message).toContain('sellers')
      expect(d.message).toContain('buyers')
    }
  })

  test('REFUSES an empty or whitespace-only field rather than sending a blank', () => {
    for (const field of ['subject', 'headline', 'body']) {
      expect(decideBroadcastDraft(draft({ [field]: '   ' })).ok).toBe(false)
      expect(decideBroadcastDraft(draft({ [field]: '' })).ok).toBe(false)
    }
  })

  test('REFUSES a half-configured button — both parts or neither', () => {
    // A label with no link renders a dead button; a link with no label loses the
    // call to action entirely. Both silently, to everyone.
    expect(decideBroadcastDraft(draft({ ctaLabel: 'Ver pedidos' })).ok).toBe(false)
    expect(decideBroadcastDraft(draft({ ctaUrl: 'https://x.com' })).ok).toBe(false)
    expect(decideBroadcastDraft(draft({ ctaLabel: 'Ver', ctaUrl: 'https://x.com' })).ok).toBe(true)
    expect(decideBroadcastDraft(draft()).ok).toBe(true)
  })

  test('REFUSES any button link that is not https', () => {
    // This link goes to every user from our own domain.
    for (const url of ['http://x.com', 'javascript:alert(1)', 'mailto:a@b.c', '/shop', 'x.com']) {
      const d = decideBroadcastDraft(draft({ ctaLabel: 'Ver', ctaUrl: url }))
      expect(d.ok, url).toBe(false)
      if (!d.ok) expect(d.field).toBe('ctaUrl')
    }
  })

  test('REFUSES at the length boundaries rather than truncating', () => {
    expect(decideBroadcastDraft(draft({ subject: 'a'.repeat(121) })).ok).toBe(false)
    expect(decideBroadcastDraft(draft({ subject: 'a'.repeat(120) })).ok).toBe(true)
    expect(decideBroadcastDraft(draft({ body: 'a'.repeat(19) })).ok).toBe(false)
  })

  test('is total — it never throws, whatever it is handed', () => {
    for (const input of [null, undefined, 0, false, 'nope', [], [1, 2], { a: 1 }]) {
      expect(() => decideBroadcastDraft(input)).not.toThrow()
      expect(decideBroadcastDraft(input).ok).toBe(false)
    }
  })
})

test.describe('decideBroadcastSend — the gate between previewed and sent', () => {
  const base = { confirm: BROADCAST_CONFIRM_PHRASE, expectedCount: 14, resolvedCount: 14 }

  test('lets an approved, unchanged, non-empty list through', () => {
    expect(decideBroadcastSend(base).ok).toBe(true)
  })

  test('REFUSES without the exact confirmation phrase', () => {
    for (const confirm of [undefined, null, '', 'enviar', 'Enviar', 'sí', 42, 'ENVIARR']) {
      const g = decideBroadcastSend({ ...base, confirm })
      expect(g.ok, String(confirm)).toBe(false)
      if (!g.ok) expect(g.reason).toBe('not_confirmed')
    }
    // Surrounding whitespace IS forgiven — a pasted phrase must not be rejected as
    // wrong. A guard that refuses correct input is one people learn to route around.
    expect(decideBroadcastSend({ ...base, confirm: '  ENVIAR  ' }).ok).toBe(true)
  })

  test('REFUSES when the list CHANGED since the preview', () => {
    // The load-bearing one. A list that grew between preview and send is a
    // different send than the one the operator approved — mailing the larger set
    // is how a broadcast surprises the person who sent it.
    const g = decideBroadcastSend({ ...base, resolvedCount: 15 })
    expect(g.ok).toBe(false)
    if (!g.ok) {
      expect(g.reason).toBe('count_changed')
      expect(g.message).toContain('14')
      expect(g.message).toContain('15')
    }
    // …and a list that SHRANK is refused too, not quietly sent to fewer.
    expect(decideBroadcastSend({ ...base, resolvedCount: 13 }).ok).toBe(false)
  })

  test('REFUSES a send with no recipients instead of reporting success over nothing', () => {
    const g = decideBroadcastSend({ ...base, expectedCount: 0, resolvedCount: 0 })
    expect(g.ok).toBe(false)
    if (!g.ok) expect(g.reason).toBe('no_recipients')
  })

  test('REFUSES above the cap, at the boundary', () => {
    const n = BROADCAST_MAX_RECIPIENTS
    expect(decideBroadcastSend({ ...base, expectedCount: n, resolvedCount: n }).ok).toBe(true)
    const over = decideBroadcastSend({ ...base, expectedCount: n + 1, resolvedCount: n + 1 })
    expect(over.ok).toBe(false)
    if (!over.ok) expect(over.reason).toBe('over_cap')
  })

  test('REFUSES when no preview count was supplied at all', () => {
    for (const expectedCount of [undefined, null, '14', 14.5]) {
      const g = decideBroadcastSend({ ...base, expectedCount })
      expect(g.ok, String(expectedCount)).toBe(false)
      if (!g.ok) expect(g.reason).toBe('no_expected_count')
    }
  })
})

test.describe('bodyParagraphs', () => {
  test('splits on blank lines and joins soft-wrapped lines', () => {
    expect(bodyParagraphs('Uno\ndos.\n\nTres.')).toEqual(['Uno dos.', 'Tres.'])
  })

  test('drops empty blocks so a stray blank line cannot render an empty paragraph', () => {
    expect(bodyParagraphs('A.\n\n\n\nB.\n\n   \n\n')).toEqual(['A.', 'B.'])
  })
})

test.describe('the surface itself', () => {
  test('preview is a DIFFERENT verb from send — and the default is preview', () => {
    // `mode !== 'send'` means an omitted or malformed mode previews. Defaulting the
    // other way would make a dropped field mail everyone.
    const source = read('app/api/admin/comunicaciones/broadcast/route.ts')
    expect(source).toContain("if (body.mode !== 'send')")
  })

  test('the draft is validated BEFORE the recipient list is read or anything sent', () => {
    // Compare CALL sites, not imports — every name appears in the import block first,
    // so indexOf on the bare identifier would compare import order and prove nothing.
    const source = read('app/api/admin/comunicaciones/broadcast/route.ts')
    const at = (call: string) => {
      const i = source.indexOf(call)
      expect(i, call).toBeGreaterThan(-1)
      return i
    }
    expect(at('decideBroadcastDraft(body)')).toBeLessThan(at('resolveBroadcastRecipients(draft.audience)'))
    expect(at('resolveBroadcastRecipients(draft.audience)')).toBeLessThan(at('sendPlatformBroadcast({'))
    expect(at('decideBroadcastSend({')).toBeLessThan(at('sendPlatformBroadcast({'))
  })

  test('it is admin-gated', () => {
    expect(read('app/api/admin/comunicaciones/broadcast/route.ts')).toContain('withAdmin')
  })

  test('an unreadable audience is an ERROR, never an empty recipient list', () => {
    // "0 recipients" from a failed query would invite an operator to conclude nobody
    // needs telling — the exact silent-failure shape the 08-15 audit unpicked.
    const source = read('lib/notifications/broadcast-recipients.ts')
    expect(source).toContain('ok: false')
    expect(source).toContain('No se pudo leer la lista de tiendas')
  })

  test('a partial send reports as partial', () => {
    const source = read('app/api/admin/comunicaciones/broadcast/route.ts')
    expect(source).toContain('complete: failed.length === 0')
  })

  test('the broadcast email uses the SAME shell as every other sender', () => {
    // One product, one look. `send()` is the shared transport that wraps `html()`.
    const source = read('lib/email.ts')
    const fn = source.slice(source.indexOf('export async function sendPlatformBroadcast'))
    expect(fn.slice(0, 900)).toContain('await send(')
    expect(fn.slice(0, 900)).toContain('h1(')
  })
})

/**
 * The reply path. Every email the platform sends comes from `noreply@`, so without
 * an explicit Reply-To a user who answers one — the most natural response when
 * something is wrong — writes into a void, and we never learn they tried.
 */
test.describe('every email is replyable', () => {
  const CONTACT = 'hola@miyagisanchez.com'

  test('Reply-To is set at the single TRANSPORT, so no sender can forget it', () => {
    const source = read('lib/email.ts')
    const call = source.slice(source.indexOf('resend().emails.send({'), source.indexOf('resend().emails.send({') + 400)
    expect(call).toContain('replyTo: REPLY_TO')
    expect(source).toContain(`const REPLY_TO = '${CONTACT}'`)
  })

  test('the contact address is NOT the from address — that is why Reply-To exists', () => {
    // If these ever became the same, the header would be redundant rather than wrong;
    // this pins the reason the indirection is there.
    const source = read('lib/email.ts')
    expect(source).toContain("const FROM = 'Miyagi Sánchez <noreply@miyagisanchez.com>'")
  })

  test('the footer names the address in BOTH locales, so it survives a copy-paste', () => {
    const source = read('lib/email.ts')
    const footer = source.slice(source.indexOf('const contact ='), source.indexOf('return `<!DOCTYPE html>'))
    expect(footer).toContain('Questions? Write to')
    expect(footer).toContain('¿Dudas? Escríbenos a')
    expect(footer).toContain('mailto:${REPLY_TO}')
  })
})

/**
 * Why a seller could not be reached.
 *
 * `getSellerEmail` used to swallow everything into `null`, so "this account has no
 * address" and "Clerk was unreachable" were the same answer. Every seller
 * notification in the product resolves its recipient through it, so that collapse
 * hid failures everywhere — and on the broadcast preview it would tell an operator
 * to go chase fourteen merchants about an account problem none of them have.
 */
test.describe('seller email lookup reports WHY it failed', () => {
  test('the two reasons are distinct, and a failure is logged', () => {
    // Slice the FUNCTION BODY, not the file: the first version of this guard matched
    // the reason strings in the type declaration and stayed green when the runtime
    // branch that returns them was deleted. A guard that cannot see the mutation is
    // not a guard.
    const source = read('lib/email.ts')
    const start = source.indexOf('export async function getSellerEmailResult')
    const body = source.slice(start, source.indexOf('export async function getSellerEmail(', start))
    expect(start).toBeGreaterThan(-1)

    // The account genuinely has no address → that exact reason, from a real branch.
    expect(body).toMatch(/email\s*\?\s*\{ email \}\s*:\s*\{ email: null, reason: 'no_email_on_account' \}/)
    // The lookup threw → the other reason, and it is LOGGED. The bare
    // `catch { return null }` this replaces is what made it invisible everywhere.
    expect(body).toContain("reason: 'lookup_failed'")
    expect(body).toContain('[getSellerEmail] Clerk lookup failed for')
  })

  test('the old single-value helper still exists for its existing callers', () => {
    // ~12 call sites only need the address; widening all of them would be a bigger
    // change than the bug warrants.
    expect(read('lib/email.ts')).toContain('export async function getSellerEmail(')
  })

  test('the preview surfaces the reason rather than flattening it', () => {
    const source = read('lib/notifications/broadcast-recipients.ts')
    expect(source).toContain('la cuenta no tiene correo')
    expect(source).toContain('no se pudo consultar Clerk')
    // A flattened reason would read as a merchant problem in every case.
    expect(source).not.toContain("reason: 'sin correo en Clerk'")
  })
})
