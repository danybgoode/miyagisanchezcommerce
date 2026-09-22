import { StatusBadge } from '@/components/ui/StatusBadge'
import type { FlagView } from '@/lib/flags-mirror-view'

/**
 * The read-only flag table (flag-provider-mandate S2.1). A SERVER component on purpose: there is no
 * toggle, no client state and no fetch — the old toggle made this page a second writer onto a
 * retired Golden catalog. Changes happen only in Golden's console (linked from the page banner).
 *
 * Receives only the CURRENT PAGE's already-filtered/sorted slice; `page.tsx` owns
 * search/filter/sort/pagination.
 */
export default function FlagsMirrorTable({ flags }: { flags: FlagView[] }) {
  if (flags.length === 0) {
    return (
      <p className="text-sm text-[var(--fg-muted)] py-6 text-center">
        Ninguna flag coincide con estos filtros.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-left border-b border-[var(--color-border)]">
            <th className="px-3 py-2 font-semibold">Flag</th>
            <th className="px-3 py-2 font-semibold">Tipo</th>
            <th className="px-3 py-2 font-semibold">Estado</th>
            <th className="px-3 py-2 font-semibold">Versión</th>
          </tr>
        </thead>
        <tbody>
          {flags.map((f) => (
            <tr key={f.key} className="border-b border-[var(--color-border)]">
              <td className="px-3 py-2">
                <div className="font-mono">{f.key}</div>
                {f.description && (
                  <div className="text-[var(--fg-muted)] mt-0.5">{f.description}</div>
                )}
                {f.unknownToCatalog && (
                  <div className="text-xs text-[var(--fg-muted)] mt-0.5">
                    Definida en Golden; este build no la lee.
                  </div>
                )}
              </td>
              <td className="px-3 py-2">
                <StatusBadge token={f.polarity === 'killswitch' ? 'info' : 'neutral'}>
                  {f.polarity === 'killswitch' ? 'Kill-switch' : 'Activación'}
                </StatusBadge>
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <StatusBadge token={f.enabled ? 'success' : 'neutral'}>
                  {f.enabled ? 'Activa' : 'Apagada'}
                </StatusBadge>
              </td>
              <td className="px-3 py-2 whitespace-nowrap text-xs text-[var(--fg-muted)]">
                <div>v{f.definitionVersion} · {f.environment} · {f.reason}</div>
                <div>riesgo {f.criticality}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
