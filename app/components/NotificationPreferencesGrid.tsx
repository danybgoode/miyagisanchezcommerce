'use client'

import type { Channel } from '@/lib/notifications/preferences'

/**
 * Shared presentational grid for a notification preference center — channels ×
 * event-groups, one toggle per cell. Extracted from the seller panel so the
 * buyer preference center (epic #5b) reuses the exact same table + switch markup;
 * each audience supplies its own groups, copy, data plumbing and locked cells.
 *
 * Pure presentation: it holds no state and does no fetching. The host owns the
 * resolved `prefs` and the `toggle` handler. Locked/checked/notes are callbacks
 * so the seller (Telegram inert until linked) and the buyer (forced receipt cell,
 * "pronto" cells) configure behaviour without forking the component.
 */

export function Switch({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none ${
        disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'
      } ${checked ? 'bg-[var(--color-accent)]' : 'bg-gray-300'}`}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  )
}

export type GroupCopy = Record<string, { label: string; summary: string }>

export type NotificationPreferencesGridProps = {
  groups: readonly string[]
  groupCopy: GroupCopy
  channels: readonly Channel[]
  channelLabels: Record<Channel, string>
  toggle: (group: string, channel: Channel, next: boolean) => void
  /** A cell that can't be changed right now (rendered disabled). */
  isLocked: (group: string, channel: Channel) => boolean
  /** The displayed checked state (a forced cell shows on; an inert cell shows off). */
  isChecked: (group: string, channel: Channel) => boolean
  /** Optional small note under a channel column header (e.g. "Conecta para activar"). */
  channelHint?: (channel: Channel) => string | null
  /** Optional small note inside a cell (e.g. "Siempre", "pronto"). */
  cellNote?: (group: string, channel: Channel) => string | null
}

export default function NotificationPreferencesGrid({
  groups,
  groupCopy,
  channels,
  channelLabels,
  toggle,
  isLocked,
  isChecked,
  channelHint,
  cellNote,
}: NotificationPreferencesGridProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-left">
            <th className="py-2 pr-3 font-medium">Evento</th>
            {channels.map(ch => {
              const hint = channelHint?.(ch)
              return (
                <th key={ch} className="px-3 py-2 text-center font-medium">
                  {channelLabels[ch]}
                  {hint && (
                    <div className="text-[10px] font-normal text-[var(--color-muted)]">{hint}</div>
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {groups.map(group => (
            <tr key={group} className="border-b border-[var(--color-border)] last:border-0">
              <td className="py-3 pr-3">
                <div className="font-medium">{groupCopy[group].label}</div>
                <div className="text-xs text-[var(--color-muted)]">{groupCopy[group].summary}</div>
              </td>
              {channels.map(ch => {
                const locked = isLocked(group, ch)
                const note = cellNote?.(group, ch)
                return (
                  <td key={ch} className="px-3 py-3 text-center">
                    <div className="inline-flex flex-col items-center justify-center gap-1">
                      <Switch
                        checked={isChecked(group, ch)}
                        disabled={locked}
                        onChange={v => toggle(group, ch, v)}
                        label={`${groupCopy[group].label} · ${channelLabels[ch]}`}
                      />
                      {note && <span className="text-[10px] text-[var(--color-muted)]">{note}</span>}
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
