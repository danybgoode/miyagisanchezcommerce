/**
 * Own-shop premium presentation (epic 07, Sprint 3) — pure "is this content
 * page authored?" helpers, shared by the public pages, the shop-home nav
 * links, and the sitemap so the three can't drift.
 *
 * The settings editor (`Paginas.tsx`) and `validateConfig()` both already
 * filter out incomplete FAQ rows before persisting — but `PATCH /api/sell/shop`
 * deep-merges `settings` with no additional validation on `about`/`faq`, so a
 * non-editor write path (a raw API call, or malformed import data) could still
 * persist a row with an empty question or answer. `wellFormedFaqItems`
 * defends against that at render time rather than trusting the write path.
 */

export interface FaqItem {
  question: string
  answer: string
}

export function wellFormedFaqItems(
  items: Array<{ question?: string; answer?: string }> | undefined | null,
): FaqItem[] {
  return (items ?? [])
    .filter((it): it is { question: string; answer: string } => !!it?.question?.trim() && !!it?.answer?.trim())
    .map((it) => ({ question: it.question.trim(), answer: it.answer.trim() }))
}

export function authoredAboutBody(about: { body?: string } | null | undefined): string | null {
  return about?.body?.trim() || null
}
