'use client'

/**
 * Transport seam for conversation realtime. Today: Supabase Realtime
 * (postgres_changes, RLS-scoped by the Clerk JWT). Swappable later
 * (Centrifugo/Memorystore, Ably, …) without touching callers.
 *
 * Subscribes to INSERTs on conversation_events and UPDATEs on the conversation
 * (unread/status). RLS guarantees the client only receives its own rows.
 */
import { useEffect, useRef, useState } from 'react'
import { useSupabaseBrowser } from '@/lib/supabase-browser'

type Row = Record<string, unknown>

export function useConversationStream(
  conversationId: string,
  handlers: { onEvent: (row: Row) => void; onConversation: (row: Row) => void },
): { connected: boolean } {
  const supabase = useSupabaseBrowser()
  const [connected, setConnected] = useState(false)
  const h = useRef(handlers)
  h.current = handlers

  useEffect(() => {
    const channel = supabase
      .channel(`conv:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'marketplace_conversation_events',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (p) => h.current.onEvent(p.new as Row),
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'marketplace_conversations',
          filter: `id=eq.${conversationId}`,
        },
        (p) => h.current.onConversation(p.new as Row),
      )
      .subscribe((status) => setConnected(status === 'SUBSCRIBED'))

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [supabase, conversationId])

  return { connected }
}
