import { useEffect, useRef, useState } from "react"
import { formatClock, formatUsdc, userLabel } from "../sim/format"
import { markedTvl } from "../sim/amm"
import { useStore } from "../sim/store"
import type { UserId } from "../sim/types"

const SPEEDS = [
  { speed: 0, label: "Pause", title: "Pause market time" },
  { speed: 1, label: "1×", title: "Realtime" },
  { speed: 60, label: "60×", title: "Two hours pass in two minutes" },
  { speed: 600, label: "600×", title: "Two hours pass in twelve seconds" },
] as const

export function Header({ onSwitched }: { onSwitched: () => void }) {
  const { state, setSpeed, setUser, reset } = useStore()
  const [open, setOpen] = useState(false)
  const [armed, setArmed] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointer(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onPointer)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onPointer)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  function choose(id: UserId) {
    setUser(id)
    setOpen(false)
    onSwitched()
  }

  function onReset() {
    if (!armed) {
      setArmed(true)
      window.setTimeout(() => setArmed(false), 2500)
      return
    }
    reset()
    setArmed(false)
    setOpen(false)
    onSwitched()
  }

  return (
    <header className="topbar">
      <div className="brand">
        <span className="mark" aria-hidden="true" />
        <span>Last Look AMM</span>
      </div>
      <div className="clock">
        <span className="clock-readout">{formatClock(state.marketTime)}</span>
        <div className="speeds" role="group" aria-label="Market clock speed">
          {SPEEDS.map((item) => (
            <button
              key={item.label}
              type="button"
              className={state.speed === item.speed ? "speed active" : "speed"}
              aria-pressed={state.speed === item.speed}
              title={item.title}
              onClick={() => setSpeed(item.speed)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="account" ref={menuRef}>
        <button type="button" className={`connect user-${state.activeUser}`} onClick={() => setOpen((value) => !value)}>
          <Avatar id={state.activeUser} />
          {userLabel(state.activeUser)}
          <Caret />
        </button>
        {open && (
          <div className="menu account-menu" role="menu">
            <MenuRow id="trader1" detail={formatUsdc(state.balances.trader1.usdc)} active={state.activeUser === "trader1"} onPick={choose} />
            <MenuRow id="trader2" detail={formatUsdc(state.balances.trader2.usdc)} active={state.activeUser === "trader2"} onPick={choose} />
            <MenuRow id="lp" detail={formatUsdc(markedTvl(state.pool) + state.balances.lp.usdc)} active={state.activeUser === "lp"} onPick={choose} />
            <button type="button" className="menu-item reset" role="menuitem" onClick={onReset}>
              {armed ? "Click again to reset" : "Reset demo"}
            </button>
          </div>
        )}
      </div>
    </header>
  )
}

function MenuRow({
  id,
  detail,
  active,
  onPick,
}: {
  id: UserId
  detail: string
  active: boolean
  onPick: (id: UserId) => void
}) {
  return (
    <button type="button" className={active ? "menu-item active" : "menu-item"} role="menuitem" onClick={() => onPick(id)}>
      <Avatar id={id} />
      <span>{userLabel(id)}</span>
      <em>{detail}</em>
    </button>
  )
}

export function Avatar({ id }: { id: UserId }) {
  const letter = id === "lp" ? "LP" : id === "trader1" ? "1" : "2"
  return <span className={`avatar user-${id}`}>{letter}</span>
}

function Caret() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2.5 4.5 L6 8 L9.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
