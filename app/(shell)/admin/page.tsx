import Link from 'next/link'
import { requireAdmin } from '@/lib/admin/guard'
import { ADMIN_SECTIONS, type AdminSection } from '@/lib/admin/sections'

export const metadata = { title: 'Panel de administración' }

/**
 * Admin hub. Replaces the old `redirect()` to the external scraper app: now a
 * real in-repo home. **Dual-accept this sprint** like every other admin page —
 * a Clerk admin (the target; humans sign in as themselves) OR the legacy
 * `?secret=<ADMIN_SECRET>` (so a secret-only operator isn't locked out of the
 * hub before `MIYAGI_ADMIN_EMAILS`/Clerk roles are configured). The secret path
 * retires in S2.3. The scraper is one external card in the registry; the
 * left-nav comes from the surrounding `AdminShell` (layout).
 */
export default async function AdminPage({ searchParams }: { searchParams: Promise<{ secret?: string }> }) {
  const { secret } = await searchParams
  await requireAdmin({ secret })

  return (
    <div style={{ maxWidth: 760 }}>
      <h1
        style={{
          fontSize: 24,
          fontWeight: 700,
          fontFamily: 'var(--font-sans)',
          color: 'var(--fg)',
          margin: '0 0 4px',
        }}
      >
        Panel de administración
      </h1>
      <p style={{ color: 'var(--fg-muted)', fontSize: 14, margin: '0 0 24px' }}>
        Herramientas internas de la plataforma. Elige una sección.
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 12,
        }}
      >
        {ADMIN_SECTIONS.map(section => (
          <SectionCard key={section.key} section={section} />
        ))}
      </div>
    </div>
  )
}

function SectionCard({ section }: { section: AdminSection }) {
  const inner = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <i className={section.icon} style={{ fontSize: 20, lineHeight: 1, color: 'var(--accent-ink)' }} />
        <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--fg)' }}>{section.label}</span>
        {section.external && (
          <i className="iconoir-arrow-up-right" style={{ fontSize: 14, lineHeight: 1, opacity: 0.6, marginLeft: 'auto' }} />
        )}
      </div>
      <p style={{ color: 'var(--fg-muted)', fontSize: 13, margin: 0 }}>{section.description}</p>
    </>
  )

  const cardStyle = {
    display: 'block',
    padding: 16,
    borderRadius: 'var(--r-lg)',
    border: '1px solid var(--border)',
    background: 'var(--bg-elevated)',
    textDecoration: 'none',
  } as const

  return section.external ? (
    <a href={section.href} target="_blank" rel="noopener noreferrer" style={cardStyle}>
      {inner}
    </a>
  ) : (
    <Link href={section.href} style={cardStyle}>
      {inner}
    </Link>
  )
}
