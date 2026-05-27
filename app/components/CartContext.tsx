'use client'

import {
  createContext, useContext, useReducer, useEffect, useCallback, useRef,
  type ReactNode,
} from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CartItem {
  productId: string
  variantId: string | null
  sellerId: string
  sellerSlug: string
  sellerName: string
  title: string
  price_cents: number
  currency: string
  imageUrl: string | null
  listing_type: string
  paymentMethods: { stripe: boolean; mp: boolean }
}

interface CartState {
  items: CartItem[]
  isOpen: boolean
  hydrated: boolean
}

type CartAction =
  | { type: 'ADD'; item: CartItem }
  | { type: 'REMOVE'; productId: string }
  | { type: 'CLEAR_SELLER'; sellerId: string }
  | { type: 'OPEN' }
  | { type: 'CLOSE' }
  | { type: 'HYDRATE'; items: CartItem[] }

interface CartContextValue {
  items: CartItem[]
  isOpen: boolean
  totalItems: number
  addItem: (item: CartItem) => void
  removeItem: (productId: string) => void
  clearSeller: (sellerId: string) => void
  openCart: () => void
  closeCart: () => void
  itemsBySeller: Map<string, CartItem[]>
}

// ── Reducer ───────────────────────────────────────────────────────────────────

function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'ADD': {
      const exists = state.items.some(i => i.productId === action.item.productId)
      if (exists) return { ...state, isOpen: true }
      return { ...state, items: [...state.items, action.item], isOpen: true }
    }
    case 'REMOVE':
      return { ...state, items: state.items.filter(i => i.productId !== action.productId) }
    case 'CLEAR_SELLER':
      return { ...state, items: state.items.filter(i => i.sellerId !== action.sellerId) }
    case 'OPEN':
      return { ...state, isOpen: true }
    case 'CLOSE':
      return { ...state, isOpen: false }
    case 'HYDRATE':
      return { ...state, items: action.items, hydrated: true }
    default:
      return state
  }
}

// ── Context ───────────────────────────────────────────────────────────────────

const CartContext = createContext<CartContextValue | null>(null)

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used inside CartProvider')
  return ctx
}

// ── Provider ──────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'ms_cart_v1'

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(cartReducer, {
    items: [],
    isOpen: false,
    hydrated: false,
  })

  // Hydrate from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as { items?: CartItem[] }
        if (Array.isArray(parsed.items)) {
          dispatch({ type: 'HYDRATE', items: parsed.items })
          return
        }
      }
    } catch { /* ignore corrupt storage */ }
    dispatch({ type: 'HYDRATE', items: [] })
  }, [])

  // Persist to localStorage whenever items change (after hydration)
  const didHydrate = useRef(false)
  useEffect(() => {
    if (!state.hydrated) return
    if (!didHydrate.current) { didHydrate.current = true; return }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ items: state.items }))
    } catch { /* quota exceeded — ignore */ }
  }, [state.items, state.hydrated])

  const addItem    = useCallback((item: CartItem) => dispatch({ type: 'ADD', item }), [])
  const removeItem = useCallback((productId: string) => dispatch({ type: 'REMOVE', productId }), [])
  const clearSeller = useCallback((sellerId: string) => dispatch({ type: 'CLEAR_SELLER', sellerId }), [])
  const openCart   = useCallback(() => dispatch({ type: 'OPEN' }), [])
  const closeCart  = useCallback(() => dispatch({ type: 'CLOSE' }), [])

  const itemsBySeller = new Map<string, CartItem[]>()
  for (const item of state.items) {
    const group = itemsBySeller.get(item.sellerId) ?? []
    group.push(item)
    itemsBySeller.set(item.sellerId, group)
  }

  return (
    <CartContext.Provider value={{
      items: state.items,
      isOpen: state.isOpen,
      totalItems: state.items.length,
      addItem,
      removeItem,
      clearSeller,
      openCart,
      closeCart,
      itemsBySeller,
    }}>
      {children}
    </CartContext.Provider>
  )
}
