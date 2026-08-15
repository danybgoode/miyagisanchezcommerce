/**
 * The admin broadcast — one operational message to every seller or every buyer.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * `/admin/contenido` publishes an announcement *on the site*; it reaches whoever
 * happens to visit. When something breaks — as it did on 2026-08-15, when manual
 * order emails had been silently dead for 32 days — the people affected need to be
 * told, not left to discover a banner.
 *
 * ── WHY IT IS PARANOID ───────────────────────────────────────────────────────
 * This is the only surface in the codebase that sends unsolicited mail to every
 * user at once. Every decision below happens BEFORE the transport is touched, and
 * the route cannot send without an exact recipient count the operator has already
 * seen. Three properties are load-bearing:
 *
 *  1. **Preview and send are different verbs.** Preview is fully read-only.
 *  2. **The count the operator approved must still hold at send time.** A list that
 *     grew between preview and send is a refusal, not a bigger send.
 *  3. **A cap.** Not because we expect to exceed it, but because "how did it email
 *     40,000 people" is a question nobody should have to answer.
 *
 * Everything here is pure. The I/O shell resolves recipients and calls the
 * transport; it makes no decisions.
 */

export const BROADCAST_AUDIENCES = ['sellers', 'buyers'] as const
export type BroadcastAudience = (typeof BROADCAST_AUDIENCES)[number]

/** Typed to force the operator through an explicit, unambiguous confirmation. */
export const BROADCAST_CONFIRM_PHRASE = 'ENVIAR'

/**
 * Hard ceiling on one broadcast. The current populations are ~14 sellers and a
 * double-digit buyer list, so this is far above anything real — it exists to bound
 * the blast radius of a bug, not to ration legitimate use.
 */
export const BROADCAST_MAX_RECIPIENTS = 500

export const BROADCAST_LIMITS = {
  subject: { min: 4, max: 120 },
  headline: { min: 4, max: 120 },
  body: { min: 20, max: 4000 },
  ctaLabel: { max: 40 },
} as const

export type BroadcastDraft = {
  audience: BroadcastAudience
  subject: string
  headline: string
  /** Plain text. Blank lines separate paragraphs; no HTML is accepted or rendered. */
  body: string
  ctaLabel: string | null
  ctaUrl: string | null
}

export type BroadcastDecision =
  | { ok: true; draft: BroadcastDraft }
  | { ok: false; field: string; message: string; status: number }

function str(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() : null
}

function reject(field: string, message: string, status = 400): BroadcastDecision {
  return { ok: false, field, message, status }
}

/**
 * Validate a draft. Total: never throws, whatever it is handed.
 *
 * Rejects rather than coerces throughout. A broadcast built from a silently
 * corrected payload is a message the operator did not write going to everyone.
 */
export function decideBroadcastDraft(input: unknown): BroadcastDecision {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return reject('body', 'Datos inválidos.')
  }
  const raw = input as Record<string, unknown>

  const audience = str(raw.audience)
  if (!audience || !(BROADCAST_AUDIENCES as readonly string[]).includes(audience)) {
    return reject('audience', `Público inválido. Usa uno de: ${BROADCAST_AUDIENCES.join(', ')}.`)
  }

  for (const field of ['subject', 'headline'] as const) {
    const value = str(raw[field])
    if (!value) return reject(field, 'Este campo es obligatorio.')
    const { min, max } = BROADCAST_LIMITS[field]
    if (value.length < min) return reject(field, `Muy corto (mínimo ${min} caracteres).`)
    if (value.length > max) return reject(field, `Muy largo (máximo ${max} caracteres).`)
  }

  const body = str(raw.body)
  if (!body) return reject('body', 'El mensaje es obligatorio.')
  if (body.length < BROADCAST_LIMITS.body.min) {
    return reject('body', `Muy corto (mínimo ${BROADCAST_LIMITS.body.min} caracteres).`)
  }
  if (body.length > BROADCAST_LIMITS.body.max) {
    return reject('body', `Muy largo (máximo ${BROADCAST_LIMITS.body.max} caracteres).`)
  }

  // The CTA is all-or-nothing. A label with no link renders a dead button; a link
  // with no label renders nothing at all and silently loses the call to action.
  const ctaLabel = str(raw.ctaLabel)
  const ctaUrl = str(raw.ctaUrl)
  if ((ctaLabel && !ctaUrl) || (ctaUrl && !ctaLabel)) {
    return reject('cta', 'El botón necesita texto y enlace, o ninguno de los dos.')
  }
  if (ctaLabel && ctaLabel.length > BROADCAST_LIMITS.ctaLabel.max) {
    return reject('ctaLabel', `Muy largo (máximo ${BROADCAST_LIMITS.ctaLabel.max} caracteres).`)
  }
  if (ctaUrl && !/^https:\/\/[^\s]+$/i.test(ctaUrl)) {
    // https only: this link goes out to every user from our own domain, so it is
    // never a place to accept http, javascript:, mailto: or a relative path.
    return reject('ctaUrl', 'El enlace debe empezar con https://')
  }

  return {
    ok: true,
    draft: {
      audience: audience as BroadcastAudience,
      subject: str(raw.subject)!,
      headline: str(raw.headline)!,
      body,
      ctaLabel: ctaLabel ?? null,
      ctaUrl: ctaUrl ?? null,
    },
  }
}

export type SendGate =
  | { ok: true }
  | { ok: false; reason: string; message: string; status: number }

/**
 * The gate between "previewed" and "sent".
 *
 * `expectedCount` is what the operator SAW. If the resolved list no longer matches
 * it, we refuse: a list that changed under them is a different send than the one
 * they approved, and silently mailing the larger set is how a broadcast surprises
 * its own operator.
 */
export function decideBroadcastSend(args: {
  confirm: unknown
  expectedCount: unknown
  resolvedCount: number
  max?: number
}): SendGate {
  const max = args.max ?? BROADCAST_MAX_RECIPIENTS

  if (str(args.confirm) !== BROADCAST_CONFIRM_PHRASE) {
    return {
      ok: false,
      reason: 'not_confirmed',
      message: `Escribe ${BROADCAST_CONFIRM_PHRASE} para confirmar el envío.`,
      status: 400,
    }
  }

  if (typeof args.expectedCount !== 'number' || !Number.isInteger(args.expectedCount)) {
    return { ok: false, reason: 'no_expected_count', message: 'Falta la vista previa.', status: 400 }
  }

  if (args.resolvedCount === 0) {
    // Zero recipients is refused rather than reported as a successful send of nothing.
    return { ok: false, reason: 'no_recipients', message: 'No hay destinatarios.', status: 409 }
  }

  if (args.resolvedCount !== args.expectedCount) {
    return {
      ok: false,
      reason: 'count_changed',
      message: `La lista cambió desde la vista previa (${args.expectedCount} → ${args.resolvedCount}). Revísala otra vez.`,
      status: 409,
    }
  }

  if (args.resolvedCount > max) {
    return {
      ok: false,
      reason: 'over_cap',
      message: `${args.resolvedCount} destinatarios supera el límite de ${max}.`,
      status: 422,
    }
  }

  return { ok: true }
}

/**
 * Plain text → the paragraph list the email template renders.
 *
 * Deliberately NOT markdown or HTML: an operator writing an outage notice under
 * pressure should not be able to inject markup into a message going to everyone,
 * and the template escapes each paragraph.
 */
export function bodyParagraphs(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((block) => block.trim().replace(/\s*\n\s*/g, ' '))
    .filter(Boolean)
}
