import AdminShell from './AdminShell'

/**
 * Admin layout — wraps every `/admin/*` page in the `AdminShell` nav chrome.
 * **Presentational only:** auth stays per-page — the hub + each section call
 * `requireAdmin()` (Clerk-gated, S2.3) themselves.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>
}
