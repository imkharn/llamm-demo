import { useEffect, useRef, useState } from "react"
import { ActivityList, PoolPanel } from "./components/PoolPanel"
import { Header } from "./components/Header"
import { HistoryList } from "./components/HistoryList"
import { ParamsPopover } from "./components/ParamsPopover"
import { SwapCard } from "./components/SwapCard"
import { WalletPanel, type ActionDraft } from "./components/WalletPanel"
import { StoreProvider, useStore } from "./sim/store"

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  )
}

function Shell() {
  const { state, swap, outbid } = useStore()
  const [tab, setTab] = useState<"main" | "second">("main")
  const [draft, setDraft] = useState<ActionDraft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [formKey, setFormKey] = useState(0)
  const [paramsOpen, setParamsOpen] = useState(false)
  const paramsRef = useRef<HTMLDivElement>(null)
  const isLp = state.activeUser === "lp"
  const pendingMine = state.fills.filter((fill) => fill.owner === state.activeUser && fill.status === "pending").length

  useEffect(() => {
    if (!paramsOpen) return
    function onPointer(event: MouseEvent) {
      if (!paramsRef.current?.contains(event.target as Node)) setParamsOpen(false)
    }
    document.addEventListener("mousedown", onPointer)
    return () => document.removeEventListener("mousedown", onPointer)
  }, [paramsOpen])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setDraft(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  function switched() {
    setDraft(null)
    setError(null)
    setTab("main")
    setFormKey((key) => key + 1)
  }

  function confirm() {
    if (!draft) return
    const result =
      draft.kind === "swap"
        ? swap({
            side: draft.side,
            asset: draft.asset,
            amount: draft.amount,
            improvePrice: draft.improvePrice,
          })
        : outbid(draft.fillId, Number(draft.price) / 100, Number(draft.size))
    if (result) {
      setError(result)
      return
    }
    if (draft.kind === "swap") setFormKey((key) => key + 1)
    setDraft(null)
    setError(null)
  }

  return (
    <div className="page">
      <Header onSwitched={switched} />
      <main>
        <section className="card">
          <div className="card-top">
            <div className="tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === "main"} className={tab === "main" ? "tab active" : "tab"} onClick={() => setTab("main")}>
                {isLp ? "Pool" : "Swap"}
              </button>
              <button type="button" role="tab" aria-selected={tab === "second"} className={tab === "second" ? "tab active" : "tab"} onClick={() => setTab("second")}>
                {isLp ? "Activity" : "History"}
                {!isLp && pendingMine > 0 && <span className="count">{pendingMine}</span>}
              </button>
            </div>
            <div className="params" ref={paramsRef}>
              <button type="button" className="gear" aria-label="Parameters" aria-expanded={paramsOpen} onClick={() => setParamsOpen((open) => !open)}>
                <Gear />
              </button>
              <ParamsPopover open={paramsOpen} />
            </div>
          </div>
          {isLp ? (
            tab === "main" ? <PoolPanel /> : <ActivityList />
          ) : tab === "main" ? (
            <SwapCard
              key={formKey}
              onSwap={(next) => {
                setError(null)
                setDraft(next)
              }}
            />
          ) : (
            <HistoryList />
          )}
        </section>
      </main>
      {draft && (
        <WalletPanel
          draft={draft}
          error={error}
          onClose={() => {
            setDraft(null)
            setError(null)
          }}
          onConfirm={confirm}
          onEdit={(price, size) => {
            setError(null)
            setDraft((current) => (current?.kind === "outbid" ? { ...current, price, size } : current))
          }}
        />
      )}
    </div>
  )
}

function Gear() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M2.5 4.5 H15.5 M2.5 9 H15.5 M2.5 13.5 H15.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="6.5" cy="4.5" r="1.7" fill="currentColor" />
      <circle cx="11.5" cy="9" r="1.7" fill="currentColor" />
      <circle cx="7.5" cy="13.5" r="1.7" fill="currentColor" />
    </svg>
  )
}
