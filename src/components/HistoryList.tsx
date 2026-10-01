import { useState } from "react"
import { formatCents, formatCountdown, formatShares, formatUsdc, sideLabel, userLabel } from "../sim/format"
import { displacementStory } from "../sim/lastLook"
import { useStore } from "../sim/store"
import type { Fill } from "../sim/types"

export function HistoryList() {
  const { state } = useStore()
  const [openId, setOpenId] = useState<string | null>(null)
  const orders = state.fills
    .slice()
    .sort((a, b) => statusRank(a.status) - statusRank(b.status) || b.createdAt - a.createdAt)

  if (orders.length === 0) {
    return (
      <div className="empty">
        <p>No trades yet.</p>
      </div>
    )
  }

  const paused = state.speed === 0 && orders.some((fill) => fill.status === "pending")

  return (
    <div className="history">
      {paused && <p className="hint">The market clock is paused, so these countdowns are holding.</p>}
      {orders.map((fill) => {
        const open = openId === fill.id
        const event = displacementStory(fill, state.fills, state.params.traderShare)
        return (
          <article key={fill.id} className={open ? "trade open" : "trade"}>
            <button
              type="button"
              className={event ? "trade-hit" : "trade-hit static"}
              onClick={() => {
                if (!event) return
                setOpenId(open ? null : fill.id)
              }}
            >
              <div className="trade-top">
                <strong>
                  {userLabel(fill.owner)} · {sideLabel(fill)}
                </strong>
                <span className={`badge badge-${fill.status}`}>{statusLabel(fill.status)}</span>
              </div>
              <p>
                {formatShares(fill.shares)} {fill.asset} at {formatCents(fill.price)}
              </p>
              {detail(fill) && <p className="muted">{detail(fill)}</p>}
              {fill.status === "pending" && (
                <p className="countdown">Finalizes in {formatCountdown(fill.deadline - state.marketTime)}</p>
              )}
              {event && <p className="muted">{open ? "Hide accounting" : "View accounting"}</p>}
            </button>
            {open && event && <Ledger event={event} />}
          </article>
        )
      })}
    </div>
  )
}

function Ledger({ event }: { event: NonNullable<ReturnType<typeof displacementStory>> }) {
  const displaced = event.displaced
  const profit = displaced.profitUsdc ?? 0
  const notional = displaced.price * displaced.shares
  return (
    <div className="ledger">
      <dl>
        <Row label="Displaced Trader" value={userLabel(displaced.owner)} />
        <Row label="New Trader" value={displaced.replacedBy ? userLabel(displaced.replacedBy) : "—"} />
        <Row label="Original Order" value={orderText(displaced, displaced.price)} />
        <Row label="New Order" value={orderText(displaced, event.nextPrice)} />
        <Row label="Rebate paid to AMM" value={formatUsdc(event.rebate)} />
        <Row label="Profit paid to displaced trader" value={`${formatUsdc(profit)}${roiText(profit, notional)}`} />
      </dl>
    </div>
  )
}

function orderText(fill: Fill, price: number): string {
  const verb = fill.side === "buy" ? "Buy" : "Sell"
  return `${verb} ${formatShares(fill.shares)} ${fill.asset} for ${formatUsdc(price * fill.shares)}`
}

function roiText(profit: number, notional: number): string {
  if (!(notional > 0)) return ""
  const pct = Math.round((profit / notional) * 10000) / 100
  const text = Number.isInteger(pct) ? String(pct) : String(pct)
  return ` (${text}% ROI)`
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function detail(fill: Fill): string {
  if (fill.status === "pending") {
    return fill.side === "buy"
      ? ""
      : `Selling into escrow. ${formatUsdc(fill.price * fill.shares)} releases when this finalizes.`
  }
  if (fill.status === "finalized") {
    return fill.side === "buy"
      ? `Received ${formatShares(fill.shares)} ${fill.asset}.`
      : `Received ${formatUsdc(fill.price * fill.shares)}.`
  }
  const profit = formatUsdc(fill.profitUsdc ?? 0)
  const owner = userLabel(fill.owner)
  if (fill.replacedBy === fill.owner) {
    return `${owner} improved this fill. ${profit} of the gap came back to them.`
  }
  const who = fill.replacedBy ? userLabel(fill.replacedBy) : "Someone"
  if (fill.side === "sell") {
    return `${who} replaced ${owner}. Returned ${formatShares(fill.returnedShares ?? 0)} ${fill.asset} and ${profit} profit.`
  }
  return `${who} replaced ${owner}. Paid ${formatUsdc(fill.payoutUsdc ?? 0)}, including ${profit} profit.`
}

function statusLabel(status: Fill["status"]): string {
  if (status === "pending") return "Pending"
  if (status === "finalized") return "Finalized"
  return "Replaced"
}

function statusRank(status: Fill["status"]): number {
  if (status === "pending") return 0
  if (status === "replaced") return 1
  return 2
}
