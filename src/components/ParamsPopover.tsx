import { useEffect, useRef, useState } from "react"
import { useStore } from "../sim/store"

export function ParamsPopover({ open }: { open: boolean }) {
  const { state, setParams } = useStore()
  const paramsRef = useRef(state.params)
  paramsRef.current = state.params
  const [hours, setHours] = useState("")
  const [outbid, setOutbid] = useState("")
  const [share, setShare] = useState("")

  useEffect(() => {
    if (!open) return
    const params = paramsRef.current
    setHours(trimNumber(params.windowMs / 3600000))
    setOutbid(trimNumber(params.minOutbid * 100))
    setShare(trimNumber(params.traderShare * 100))
  }, [open])

  if (!open) return null

  function commit(next: { windowMs?: number; minOutbid?: number; traderShare?: number }) {
    setParams({ ...state.params, ...next })
  }

  return (
    <div className="popover" role="dialog" aria-label="Last look parameters">
      <label>
        <span>Window (hours)</span>
        <input
          inputMode="decimal"
          value={hours}
          onChange={(event) => {
            const text = decimal(event.target.value)
            setHours(text)
            const value = Number(text)
            if (value >= 1 / 60) commit({ windowMs: value * 3600000 })
          }}
        />
      </label>
      <label>
        <span>Minimum outbid (%)</span>
        <input
          inputMode="decimal"
          value={outbid}
          onChange={(event) => {
            const text = decimal(event.target.value)
            setOutbid(text)
            const value = Number(text)
            if (value > 0) commit({ minOutbid: value / 100 })
          }}
        />
      </label>
      <label>
        <span>Trader share of the gap (%)</span>
        <input
          inputMode="decimal"
          value={share}
          onChange={(event) => {
            const text = decimal(event.target.value)
            setShare(text)
            const value = Number(text)
            if (value >= 0 && value <= 100) commit({ traderShare: value / 100 })
          }}
        />
      </label>
      <p>The window applies to new fills. The outbid and share apply the next time someone replaces a trade.</p>
    </div>
  )
}

function decimal(value: string): string {
  const cleaned = value.replace(/[^\d.]/g, "")
  const [whole, ...rest] = cleaned.split(".")
  return rest.length ? `${whole}.${rest.join("")}` : whole
}

function trimNumber(value: number): string {
  return String(Math.round(value * 1000) / 1000)
}
