export type GoldenFlagProviderSlot = 'primary' | 'partners-recruiting-v3'

export type DurableMirrorStorage =
  | {
      table: 'golden_flag_snapshot_mirror'
      rpc: 'persist_golden_flag_snapshot'
    }
  | {
      table: 'golden_flag_scoped_snapshot_mirror'
      rpc: 'persist_scoped_golden_flag_snapshot'
      providerScope: 'partners-recruiting-v3'
    }

/**
 * Snapshot versions are project-relative, so each Golden credential needs an
 * independently monotonic durable lane. The established primary lane keeps its
 * original table/RPC; scoped catalogs use the explicitly keyed companion store.
 */
export function durableMirrorStorageForSlot(
  slot: GoldenFlagProviderSlot,
): DurableMirrorStorage {
  if (slot === 'primary') {
    return {
      table: 'golden_flag_snapshot_mirror',
      rpc: 'persist_golden_flag_snapshot',
    }
  }
  return {
    table: 'golden_flag_scoped_snapshot_mirror',
    rpc: 'persist_scoped_golden_flag_snapshot',
    providerScope: slot,
  }
}
