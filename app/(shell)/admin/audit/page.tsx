import { requireAdmin } from '@/lib/admin/guard'
import { db } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Auditoría — Admin' }

type AuditRow = {
  id: string
  actor_user_id: string | null
  actor_email: string | null
  action: string
  target: string | null
  payload_summary: Record<string, unknown> | null
  created_at: string
}

/**
 * Read-only viewer over `admin_audit_log` (S2.3). Every admin mutation through
 * `withAdmin` writes a row here (S2.1). Clerk-gated; latest 200 actions.
 */
export default async function AdminAuditPage() {
  await requireAdmin()

  const { data } = await db
    .from('admin_audit_log')
    .select('id, actor_user_id, actor_email, action, target, payload_summary, created_at')
    .order('created_at', { ascending: false })
    .limit(200)
  const rows = (data ?? []) as AuditRow[]

  const fmt = (iso: string) =>
    new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))

  return (
    <div style={{ maxWidth: 960 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 4px', color: 'var(--fg)' }}>Auditoría</h1>
      <p style={{ color: 'var(--fg-muted)', fontSize: 14, margin: '0 0 24px' }}>
        Registro de cada acción administrativa (quién, qué, cuándo). Las últimas 200.
      </p>

      {rows.length === 0 ? (
        <p style={{ color: 'var(--fg-muted)', fontSize: 14 }}>Sin acciones registradas todavía.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '8px 12px', fontWeight: 600 }}>Cuándo</th>
                <th style={{ padding: '8px 12px', fontWeight: 600 }}>Admin</th>
                <th style={{ padding: '8px 12px', fontWeight: 600 }}>Acción</th>
                <th style={{ padding: '8px 12px', fontWeight: 600 }}>Objetivo</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', color: 'var(--fg-muted)' }}>{fmt(r.created_at)}</td>
                  <td style={{ padding: '8px 12px' }}>{r.actor_email ?? r.actor_user_id ?? '—'}</td>
                  <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono, monospace)' }}>{r.action}</td>
                  <td style={{ padding: '8px 12px', color: 'var(--fg-muted)' }}>{r.target ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
