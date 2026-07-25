import { loadPortfolio } from '@/lib/portfolio/loader'
import { resolveActor } from '@/lib/relationship-access'
import { stageLabel } from '@/lib/merchant-stage-labels'
import {
  parsePortfolioFilters,
  type PortfolioDueState,
  type PortfolioFilters,
  type PortfolioRow,
} from '@/lib/portfolio/resolver'

/**
 * `/partner` → the Merchant Partner stewardship portfolio section (Merchant
 * Partner lifecycle · Sprint 1, Story 1.2). Rendered ABOVE today's grant list,
 * and ONLY when `promoter.partner_portfolio_enabled` is ON — the page itself
 * makes that decision, so with the flag OFF this component is never even
 * imported into the render and `/partner` is byte-identical to today (the whole
 * promise of the kill-switch, asserted in `e2e/portfolio-routes.spec.ts`).
 *
 * A SERVER component that calls `loadPortfolio` directly rather than fetching
 * its own API route: the page is already `force-dynamic`, so this is one less
 * hop, needs no client JavaScript at all, and cannot show a loading state that
 * hides a failed read. `GET /api/partner/portfolio` exists for the agent /
 * programmatic consumers (and Sprint 3's parity requirement) and goes through
 * the SAME loader → SAME pure resolver, so the two can never disagree.
 *
 * AN ACTION QUEUE, NOT A DENSE CRM (build contract). The default view is "needs
 * action" — overdue, nothing scheduled, or blocked. Filters are plain links, so
 * the surface works with no JS.
 *
 * SAFE-ONLY CONTACT DATA: this component renders the preferred-channel LABEL
 * and never a phone/email/WhatsApp/Instagram value, because
 * `lib/portfolio/resolver.ts`'s DTO does not carry one.
 *
 * FAIL CLOSED, VISIBLY: a failed read renders an explicit error, never an empty
 * list. "Your portfolio is empty" and "we could not read your portfolio" must
 * never look the same to a partner.
 *
 * es-MX only. Iconoir icons, never emoji (there is a CI guard). No Tailwind
 * arbitrary value is built by string interpolation anywhere below.
 */

const DUE_STATE_LABEL: Readonly<Record<PortfolioDueState, string>> = {
  overdue: 'Vencido',
  due_soon: 'Por vencer',
  scheduled: 'Agendado',
  missing: 'Sin próxima acción',
}

const OVERDUE_REASON_LABEL: Readonly<Record<string, string>> = {
  action_past_due: 'La próxima acción ya venció',
  no_dated_action: 'Sin próxima acción con fecha dentro del plazo de respuesta',
  stage_stalled: 'Demasiado tiempo en esta etapa',
}

const CONSENT_LABEL: Readonly<Record<string, string>> = {
  sin_vista_previa: 'Sin vista previa',
  vista_previa_draft: 'Vista previa en borrador',
  vista_previa_approved: 'Vista previa aprobada',
  vista_previa_changes_requested: 'Cambios solicitados',
  vista_previa_invalidated: 'Vista previa invalidada',
  vista_previa_activated: 'Vista previa activada',
}

/** Fixed, complete class strings per state — never built by interpolating a
 *  value into a Tailwind class (LEARNINGS: a JIT-interpolated arbitrary value
 *  silently emits no CSS). */
const DUE_STATE_BADGE: Readonly<Record<PortfolioDueState, string>> = {
  overdue: 'badge badge-danger',
  due_soon: 'badge badge-warning',
  scheduled: 'badge badge-success',
  missing: 'badge badge-warning',
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return '—'
  return new Date(ms).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' })
}

/** Build a filter URL from the CURRENT filters plus one override. Only ever
 *  emits the params the pure parser reads back, so a link can never encode a
 *  filter state the resolver would drop. */
function filterHref(current: PortfolioFilters, override: Partial<Record<'view' | 'due' | 'blocker' | 'stage', string | null>>): string {
  const params = new URLSearchParams()
  const view = 'view' in override ? override.view : current.view === 'all' ? 'all' : null
  const due = 'due' in override ? override.due : (current.dueState ?? null)
  const blocker = 'blocker' in override ? override.blocker : current.blocker === undefined ? null : String(current.blocker)
  const stage = 'stage' in override ? override.stage : (current.stage ?? null)
  if (view) params.set('view', view)
  if (due) params.set('due', due)
  if (blocker) params.set('blocker', blocker)
  if (stage) params.set('stage', stage)
  const qs = params.toString()
  return qs ? `/partner?${qs}` : '/partner'
}

function PortfolioCard({ row }: { row: PortfolioRow }) {
  return (
    <li className="p-4 space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">{row.businessName}</span>
        <span className="text-xs text-[var(--color-muted)]">
          {[row.municipio, row.estado].filter(Boolean).join(', ')}
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-2 text-xs">
          <span className="badge badge-info">{stageLabel(row.stage)}</span>
          <span className={DUE_STATE_BADGE[row.dueState]}>{DUE_STATE_LABEL[row.dueState]}</span>
          {row.blocker && (
            <span className="badge badge-danger">
              <i className="iconoir-warning-triangle" aria-hidden /> Bloqueo
            </span>
          )}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-muted)]">
        <span>
          <i className="iconoir-hourglass" aria-hidden /> {row.ageInStageDays} d en etapa
        </span>
        <span>
          <i className="iconoir-calendar" aria-hidden /> Compromiso: {fmtDate(row.slaDueAt)}
        </span>
        <span>
          <i className="iconoir-chat-bubble" aria-hidden /> Último contacto: {fmtDate(row.lastInteractionAt)}
        </span>
        {row.preferredChannel && (
          <span>
            <i className="iconoir-message-text" aria-hidden /> Prefiere {row.preferredChannel}
          </span>
        )}
        <span>{CONSENT_LABEL[row.consentState] ?? row.consentState}</span>
      </div>

      {row.slaOverdue && row.slaOverdueReason && (
        <p className="text-xs text-[color:var(--danger)]">
          <i className="iconoir-warning-triangle" aria-hidden />{' '}
          {OVERDUE_REASON_LABEL[row.slaOverdueReason] ?? row.slaOverdueReason}
          {row.escalationTarget ? ' · escala con el responsable asignado' : ''}
        </p>
      )}

      {row.assignmentReason && (
        <p className="text-xs text-[var(--color-muted)]">
          <i className="iconoir-user-star" aria-hidden /> Asignación: {row.assignmentReason}
          {row.assignedAt ? ` · ${fmtDate(row.assignedAt)}` : ''}
        </p>
      )}
    </li>
  )
}

export default async function PartnerPortfolio({
  clerkUserId,
  searchParams,
}: {
  clerkUserId: string
  searchParams: URLSearchParams
}) {
  const filters = parsePortfolioFilters(searchParams)
  // The scoped population and the four-actor rule are BOTH imported, never
  // re-derived here (README D2).
  const actor = await resolveActor(clerkUserId)
  const result = await loadPortfolio(actor, filters)

  if (!result.ok) {
    return (
      <section className="rounded-lg border border-[color:var(--danger)] p-4 space-y-1">
        <h2 className="font-semibold">Cartera de comercios</h2>
        <p className="text-sm text-[color:var(--danger)]">
          <i className="iconoir-warning-triangle" aria-hidden /> {result.error} Vuelve a intentarlo en un
          momento — esto NO significa que tu cartera esté vacía.
        </p>
      </section>
    )
  }

  const { summary, rows } = result.portfolio
  const showingNeedsAction = filters.view === 'needs_action'

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold">Cartera de comercios</h2>
        <p className="text-xs text-[var(--color-muted)]">
          {rows.length} de {summary.total} · {summary.overdue} vencidos · {summary.missing} sin próxima acción ·{' '}
          {summary.blocked} con bloqueo
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <a href={filterHref(filters, { view: null, due: null, blocker: null })} className={showingNeedsAction && !filters.dueState && filters.blocker === undefined ? 'badge badge-info' : 'badge badge-neutral'}>
          Requieren acción
        </a>
        <a href={filterHref(filters, { view: 'all', due: null, blocker: null })} className={filters.view === 'all' && !filters.dueState && filters.blocker === undefined ? 'badge badge-info' : 'badge badge-neutral'}>
          Todos
        </a>
        <a href={filterHref(filters, { view: 'all', due: 'overdue', blocker: null })} className={filters.dueState === 'overdue' ? 'badge badge-info' : 'badge badge-neutral'}>
          Vencidos
        </a>
        <a href={filterHref(filters, { view: 'all', due: 'due_soon', blocker: null })} className={filters.dueState === 'due_soon' ? 'badge badge-info' : 'badge badge-neutral'}>
          Por vencer
        </a>
        <a href={filterHref(filters, { view: 'all', due: 'missing', blocker: null })} className={filters.dueState === 'missing' ? 'badge badge-info' : 'badge badge-neutral'}>
          Sin próxima acción
        </a>
        <a href={filterHref(filters, { view: 'all', due: null, blocker: 'true' })} className={filters.blocker === true ? 'badge badge-info' : 'badge badge-neutral'}>
          Con bloqueo
        </a>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-[var(--color-muted)] rounded-lg border border-[var(--color-border)] p-4">
          {showingNeedsAction && summary.total > 0
            ? 'Nada pendiente ahora mismo: ninguno de tus comercios está vencido, sin próxima acción ni bloqueado.'
            : 'Todavía no hay comercios en tu cartera. Un comercio llega aquí cuando te asignan su seguimiento o cuando un administrador te concede acceso a su tienda.'}
        </p>
      ) : (
        <ul className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
          {rows.map((row) => (
            <PortfolioCard key={row.id} row={row} />
          ))}
        </ul>
      )}
    </section>
  )
}
