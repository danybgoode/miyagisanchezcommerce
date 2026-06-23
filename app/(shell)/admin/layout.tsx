import AdminShell from './AdminShell'

/**
 * Admin layout — wraps every `/admin/*` page in the `AdminShell` nav chrome.
 * **Presentational only:** auth stays per-page (a layout can't read `?secret=`,
 * and the route guards remain dual-accepted this sprint). The hub + each
 * section call `requireAdmin(...)` themselves.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>
}
