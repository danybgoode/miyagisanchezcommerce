'use client'

import {
  createContext, useContext, useEffect, useState,
  type Dispatch, type SetStateAction, type ReactNode,
} from 'react'
import type { AgentPromptDetails } from '@/lib/agent-prompt'

/**
 * AgentContext — threads a page's human-readable details (product title/price, shop
 * name) into the navbar "Compra con tu agente IA" card (AIAgentButton). The card lives
 * in the server/static PlatformShell, which reads no per-page data, so a SERVER page
 * pushes its details through this client island instead (Sprint 2).
 *
 * Two contexts so the value re-renders only the consumer (the button) and the setter
 * stays stable for the page islands.
 */
const ValueContext = createContext<AgentPromptDetails | null>(null)
const SetterContext = createContext<Dispatch<SetStateAction<AgentPromptDetails | null>> | null>(null)

/** Current page's hand-off details, or null (no provider / not yet set / generic page). */
export function useAgentContext(): AgentPromptDetails | null {
  return useContext(ValueContext)
}

export function AgentContextProvider({ children }: { children: ReactNode }) {
  const [details, setDetails] = useState<AgentPromptDetails | null>(null)
  return (
    <SetterContext.Provider value={setDetails}>
      <ValueContext.Provider value={details}>
        {children}
      </ValueContext.Provider>
    </SetterContext.Provider>
  )
}

/**
 * Render-null island a SERVER page renders to push its page-specific details without
 * becoming a client component. Sets on mount / prop-change and **clears on unmount** so
 * the context never bleeds across navigation (a homepage opens the generic prompt again).
 */
export function SetAgentContext({ title, price, shopName }: AgentPromptDetails) {
  const setDetails = useContext(SetterContext)
  useEffect(() => {
    const mine: AgentPromptDetails = { title, price, shopName }
    setDetails?.(mine)
    // Compare-and-clear: only null out if the context still holds OUR object. During a
    // client navigation the next page's island can set its details before this one's
    // cleanup runs — a blind `setDetails(null)` would then erase the new page's context.
    return () => setDetails?.(prev => (prev === mine ? null : prev))
  }, [setDetails, title, price, shopName])
  return null
}
