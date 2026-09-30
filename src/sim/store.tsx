import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { flushSync } from "react-dom"
import { finalizeDue, initialState, sanitizeParams, applyOutbid, applySwap } from "./lastLook"
import type { MarketState, Params, Result, SwapInput, UserId } from "./types"

const STORAGE_KEY = "llamm-demo-v2"

interface StoreApi {
  state: MarketState
  setUser: (id: UserId) => void
  setSpeed: (speed: number) => void
  setParams: (params: Params) => void
  reset: () => void
  swap: (input: Omit<SwapInput, "user">) => string | null
  outbid: (fillId: string, price: number, shares: number) => string | null
}

const StoreContext = createContext<StoreApi | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MarketState>(() => loadState() ?? initialState())

  useEffect(() => {
    let last = performance.now()
    const id = window.setInterval(() => {
      const now = performance.now()
      const dt = Math.min(now - last, 500)
      last = now
      setState((current) => {
        if (current.speed <= 0 || dt <= 0) return current
        return finalizeDue({ ...current, marketTime: current.marketTime + dt * current.speed })
      })
    }, 100)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  const commit = (fn: (current: MarketState) => Result): string | null => {
    let error: string | null = null
    flushSync(() => {
      setState((current) => {
        const result = fn(current)
        if (!result.ok) {
          error = result.error
          return current
        }
        error = null
        return result.state
      })
    })
    return error
  }

  const api: StoreApi = {
    state,
    setUser: (id) => setState((current) => ({ ...current, activeUser: id })),
    setSpeed: (speed) => setState((current) => ({ ...current, speed })),
    setParams: (params) => setState((current) => ({ ...current, params: sanitizeParams(params) })),
    reset: () => {
      localStorage.removeItem(STORAGE_KEY)
      setState(initialState())
    },
    swap: (input) => commit((current) => applySwap(current, { ...input, user: current.activeUser })),
    outbid: (fillId, price, shares) =>
      commit((current) => applyOutbid(current, current.activeUser, fillId, price, shares)),
  }

  return <StoreContext.Provider value={api}>{children}</StoreContext.Provider>
}

export function useStore(): StoreApi {
  const store = useContext(StoreContext)
  if (!store) throw new Error("useStore must be used inside StoreProvider")
  return store
}

function loadState(): MarketState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return null
    const state = parsed as MarketState
    if (!state.pool || typeof state.pool.yes !== "number" || typeof state.pool.no !== "number") return null
    if (!state.balances?.trader1 || !state.balances?.trader2 || !state.balances?.lp) return null
    if (!Array.isArray(state.fills) || !Array.isArray(state.activity) || !state.params) return null
    const active: UserId[] = ["trader1", "trader2", "lp"]
    return {
      ...initialState(),
      ...state,
      params: sanitizeParams(state.params),
      activeUser: active.includes(state.activeUser) ? state.activeUser : "trader1",
      speed: [0, 1, 60, 600].includes(state.speed) ? state.speed : 0,
      rebates: typeof state.rebates === "number" ? state.rebates : 0,
    }
  } catch {
    return null
  }
}
